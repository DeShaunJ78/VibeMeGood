/**
 * Walk-forward replay backtest for the projection factor engine.
 *
 * For every player+statType game-log series, ordered by date, we replay history:
 * at each game we build a projection from ONLY the prior games (no leakage),
 * evaluate it against a pseudo-line (trailing median of prior values), and
 * compare the predicted P(over) to the actual outcome.
 *
 * We then re-run the SAME projection after applying the real factor engine
 * (factors.ts) and measure the marginal lift each factor adds. Only factors
 * whose inputs are derivable purely from historical game logs are evaluated
 * here — rest/B2B and home/away. Pace, DvP, implied team total, weather and
 * NFL-advanced factors depend on external context that is not stored on the
 * historical logs, so they are NOT fabricated; they are reported as
 * "not evaluable from logs" so the report stays honest.
 *
 * Run:  pnpm --filter @workspace/api-server run backtest
 */

import { db } from "@workspace/db";
import { playerGameLogsTable } from "@workspace/db/schema";
import { asc } from "drizzle-orm";
import { pOverLineDist } from "../lib/projection/distributions.js";
import {
  restFactor,
  homeAwayFactor,
  combineFactors,
  type FactorResult,
} from "../lib/projection/factors.js";

const MIN_PRIOR = 5; // need at least this many prior games to project
const STD_FLOOR_PCT = 0.1; // floor sigma at 10% of mean so pOver isn't degenerate

interface LogRow {
  gameDate: string;
  value: number;
  homeAway: string | null;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sampleStd(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000,
  );
}

/** Accumulators for a probabilistic model's calibration & accuracy. */
class Stats {
  n = 0;
  brierSum = 0; // mean squared error of P(over) vs actual {0,1}
  confidentN = 0; // predictions where |p-0.5| >= 0.1
  confidentHits = 0; // confident predictions that were directionally correct
  // 10 calibration buckets by predicted probability
  bucketPredSum = new Array(10).fill(0);
  bucketActSum = new Array(10).fill(0);
  bucketN = new Array(10).fill(0);

  add(pOver01: number, actualOver: boolean) {
    const y = actualOver ? 1 : 0;
    this.n++;
    this.brierSum += (pOver01 - y) ** 2;
    if (Math.abs(pOver01 - 0.5) >= 0.1) {
      this.confidentN++;
      const pickOver = pOver01 > 0.5;
      if (pickOver === actualOver) this.confidentHits++;
    }
    const b = Math.min(9, Math.max(0, Math.floor(pOver01 * 10)));
    this.bucketPredSum[b] += pOver01;
    this.bucketActSum[b] += y;
    this.bucketN[b]++;
  }

  brier(): number {
    return this.n ? this.brierSum / this.n : NaN;
  }
  hitRate(): number {
    return this.confidentN ? this.confidentHits / this.confidentN : NaN;
  }
}

async function main() {
  console.log("Loading player game logs…");
  const rows = await db
    .select({
      playerId: playerGameLogsTable.playerId,
      statType: playerGameLogsTable.statType,
      gameDate: playerGameLogsTable.gameDate,
      value: playerGameLogsTable.value,
      homeAway: playerGameLogsTable.homeAway,
    })
    .from(playerGameLogsTable)
    .orderBy(
      asc(playerGameLogsTable.playerId),
      asc(playerGameLogsTable.statType),
      asc(playerGameLogsTable.gameDate),
    );

  // group into series keyed by player+statType
  const series = new Map<string, { statType: string; logs: LogRow[] }>();
  for (const r of rows) {
    const key = `${r.playerId}::${r.statType}`;
    const existing = series.get(key);
    const logs = existing?.logs ?? [];
    logs.push({
      gameDate: r.gameDate,
      value: Number(r.value),
      homeAway: r.homeAway,
    });
    series.set(key, { statType: r.statType, logs });
  }

  const base = new Stats();
  const adjusted = new Stats();
  // per-factor: rows where the factor was applied, base vs adjusted brier/hits
  const perFactor = new Map<string, { base: Stats; adj: Stats }>();
  const ensureFactor = (k: string) => {
    let f = perFactor.get(k);
    if (!f) {
      f = { base: new Stats(), adj: new Stats() };
      perFactor.set(k, f);
    }
    return f;
  };

  let seriesUsed = 0;
  let predictions = 0;

  for (const [, { statType, logs }] of series) {
    if (logs.length < MIN_PRIOR + 1) continue;
    seriesUsed++;

    for (let i = MIN_PRIOR; i < logs.length; i++) {
      const prior = logs.slice(0, i);
      const cur = logs[i];
      const priorVals = prior.map((p) => p.value);

      const mu = mean(priorVals);
      if (mu <= 0) continue;
      const std = Math.max(sampleStd(priorVals, mu), mu * STD_FLOOR_PCT);
      const line = median(priorVals); // pseudo-line
      const actualOver = cur.value > line;

      // ── base projection ──
      const basePOver = pOverLineDist(mu, std, line, statType) / 100;
      base.add(basePOver, actualOver);

      // ── derive log-only factor inputs ──
      const prevDate = prior[prior.length - 1].gameDate;
      const daysRest = daysBetween(prevDate, cur.gameDate);
      const isBackToBack = daysRest <= 1;
      // 3-in-4: count current + prior games whose date is within 3 days of cur
      const windowStart = new Date(cur.gameDate).getTime() - 3 * 86_400_000;
      const gamesInWindow =
        1 +
        prior.filter((p) => new Date(p.gameDate).getTime() >= windowStart)
          .length;
      const isThreeInFour = gamesInWindow >= 3;

      const isHome =
        cur.homeAway == null ? null : cur.homeAway.toLowerCase() === "home";
      const homeVals = prior
        .filter((p) => p.homeAway?.toLowerCase() === "home")
        .map((p) => p.value);
      const awayVals = prior
        .filter((p) => p.homeAway?.toLowerCase() === "away")
        .map((p) => p.value);

      const applied: (FactorResult | null)[] = [
        restFactor({ isBackToBack, isThreeInFour, daysRest }),
        homeAwayFactor({
          isHome,
          homeAvg: homeVals.length ? mean(homeVals) : null,
          awayAvg: awayVals.length ? mean(awayVals) : null,
        }),
      ];

      const { combinedFactor, applied: appliedFactors } =
        combineFactors(applied);
      const adjMu = mu * combinedFactor;
      const adjPOver = pOverLineDist(adjMu, std, line, statType) / 100;
      adjusted.add(adjPOver, actualOver);

      // True per-factor marginal lift: apply ONLY that one factor (isolated
      // counterfactual) so rows with multiple factors don't credit the joint
      // effect to each. base = no factors; +factor = just this factor.
      for (const f of appliedFactors) {
        const solo = combineFactors([f]).combinedFactor;
        const soloPOver = pOverLineDist(mu * solo, std, line, statType) / 100;
        const slot = ensureFactor(f.key);
        slot.base.add(basePOver, actualOver);
        slot.adj.add(soloPOver, actualOver);
      }

      predictions++;
    }
  }

  const pct = (x: number) => (isNaN(x) ? "  n/a" : (x * 100).toFixed(1) + "%");
  const num = (x: number) => (isNaN(x) ? "n/a" : x.toFixed(4));

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" WALK-FORWARD BACKTEST");
  console.log("══════════════════════════════════════════════════════════");
  console.log(
    `series used: ${seriesUsed}   predictions: ${predictions}   (min prior=${MIN_PRIOR})`,
  );
  if (predictions === 0) {
    console.log(
      "\nNo predictions produced — game-log history is too short to replay.",
    );
    console.log("Seed/sync more player_game_logs and re-run.");
    return;
  }

  console.log("\n── Overall accuracy (lower Brier better) ──");
  console.log(
    `              Brier      Confident hit-rate (|p-0.5|≥0.1)`,
  );
  console.log(
    `base model    ${num(base.brier())}     ${pct(base.hitRate())}  (n=${base.confidentN})`,
  );
  console.log(
    `+ factors     ${num(adjusted.brier())}     ${pct(adjusted.hitRate())}  (n=${adjusted.confidentN})`,
  );
  const brierLift = base.brier() - adjusted.brier();
  console.log(
    `Brier delta   ${brierLift >= 0 ? "+" : ""}${num(brierLift)}  (${brierLift >= 0 ? "improvement" : "REGRESSION"})`,
  );

  console.log("\n── Calibration (base model): predicted vs empirical over-rate ──");
  console.log("bucket   n     pred    actual");
  for (let b = 0; b < 10; b++) {
    if (!base.bucketN[b]) continue;
    const pred = base.bucketPredSum[b] / base.bucketN[b];
    const act = base.bucketActSum[b] / base.bucketN[b];
    console.log(
      `${(b * 10).toString().padStart(2)}-${b * 10 + 10}%  ${base.bucketN[b]
        .toString()
        .padStart(5)}  ${pct(pred)}  ${pct(act)}`,
    );
  }

  console.log("\n── Per-factor marginal lift (only rows where factor applied) ──");
  console.log("factor        rows    base Brier   +factor Brier   delta");
  for (const [key, { base: b, adj: a }] of perFactor) {
    const delta = b.brier() - a.brier();
    console.log(
      `${key.padEnd(12)}  ${b.n.toString().padStart(5)}   ${num(b.brier())}      ${num(a.brier())}      ${delta >= 0 ? "+" : ""}${num(delta)}`,
    );
  }

  console.log("\n── Factors NOT evaluable from game logs alone ──");
  console.log(
    "pace, dvp, impliedTotal, weather, nflAdvanced — these need external",
  );
  console.log(
    "context (odds, opponent DvP, stadium weather, usage) not stored on",
  );
  console.log(
    "historical logs. They are intentionally left out rather than faked.",
  );
  console.log("══════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
