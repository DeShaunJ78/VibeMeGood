/**
 * Walk-forward backtest engine.
 *
 * Extracted from backtest.ts so it can be called from both the CLI script
 * and the API route (POST /api/audit/run). Returns a structured result that
 * is stored in the database and served to the Audit Dashboard.
 */

import { db } from "@workspace/db";
import { playerGameLogsTable, playersTable } from "@workspace/db/schema";
import { asc, eq } from "drizzle-orm";
import { pOverLineDist } from "./distributions.js";
import {
  restFactor,
  homeAwayFactor,
  combineFactors,
  type FactorResult,
} from "./factors.js";

// ── constants ────────────────────────────────────────────────────────────────

export const MIN_PRIOR = 5;
const STD_FLOOR_PCT = 0.1;
const MIN_STAT_N = 50;
const MIN_SPORT_N = 50;

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── accumulator ──────────────────────────────────────────────────────────────

export class StatsAccum {
  n = 0;
  brierSum = 0;
  confidentN = 0;
  confidentHits = 0;
  bucketPredSum = new Array(10).fill(0);
  bucketActSum  = new Array(10).fill(0);
  bucketN       = new Array(10).fill(0);

  add(pOver01: number, actualOver: boolean) {
    const y = actualOver ? 1 : 0;
    this.n++;
    this.brierSum += (pOver01 - y) ** 2;
    if (Math.abs(pOver01 - 0.5) >= 0.1) {
      this.confidentN++;
      if ((pOver01 > 0.5) === actualOver) this.confidentHits++;
    }
    const b = Math.min(9, Math.max(0, Math.floor(pOver01 * 10)));
    this.bucketPredSum[b] += pOver01;
    this.bucketActSum[b]  += y;
    this.bucketN[b]++;
  }

  brier(): number { return this.n ? this.brierSum / this.n : NaN; }
  hitRate(): number { return this.confidentN ? this.confidentHits / this.confidentN : NaN; }

  ece(): number {
    if (!this.n) return NaN;
    let wsum = 0;
    for (let b = 0; b < 10; b++) {
      if (!this.bucketN[b]) continue;
      const pred = this.bucketPredSum[b] / this.bucketN[b];
      const act  = this.bucketActSum[b]  / this.bucketN[b];
      wsum += this.bucketN[b] * Math.abs(pred - act);
    }
    return wsum / this.n;
  }

  maxCalError(): number {
    let max = 0;
    for (let b = 0; b < 10; b++) {
      if (!this.bucketN[b]) continue;
      const pred = this.bucketPredSum[b] / this.bucketN[b];
      const act  = this.bucketActSum[b]  / this.bucketN[b];
      max = Math.max(max, Math.abs(pred - act));
    }
    return max;
  }

  toSummaryMetrics() {
    return {
      brier:        round4(this.brier()),
      confHitRate:  round4(this.hitRate()),
      ece:          round4(this.ece()),
      maxCalError:  round4(this.maxCalError()),
      n:            this.n,
      confidentN:   this.confidentN,
    };
  }

  calibrationBuckets() {
    const out = [];
    for (let b = 0; b < 10; b++) {
      if (!this.bucketN[b]) continue;
      const pred = this.bucketPredSum[b] / this.bucketN[b];
      const act  = this.bucketActSum[b]  / this.bucketN[b];
      out.push({
        bucket:    `${b * 10}-${b * 10 + 10}%`,
        n:         this.bucketN[b],
        predicted: round4(pred),
        actual:    round4(act),
        gap:       round4(act - pred),
      });
    }
    return out;
  }
}

// ── edge-bucket accumulator ──────────────────────────────────────────────────

interface EdgeBucketAccum {
  n: number;
  predSum: number;
  hits: number;
}

const EDGE_BREAKPOINTS = [0.0, 0.05, 0.10, 0.15, 0.20];
const EDGE_LABELS      = ["0-5%", "5-10%", "10-15%", "15-20%", "20%+"];

function edgeBucketIndex(pOver01: number): number {
  const edge = Math.abs(pOver01 - 0.5);
  for (let i = EDGE_BREAKPOINTS.length - 1; i >= 0; i--) {
    if (edge >= EDGE_BREAKPOINTS[i]) return i;
  }
  return 0;
}

// ── types ────────────────────────────────────────────────────────────────────

function round4(x: number): number {
  return isNaN(x) ? 0 : Math.round(x * 10000) / 10000;
}

export interface SummaryMetrics {
  brier:       number;
  confHitRate: number;
  ece:         number;
  maxCalError: number;
  n:           number;
  confidentN:  number;
}

export interface StatRow {
  statType:    string;
  n:           number;
  brier:       number;
  confHitRate: number;
  ece:         number;
  maxCalError: number;
}

export interface SportRow {
  sport:       string;
  n:           number;
  brier:       number;
  confHitRate: number;
  ece:         number;
  maxCalError: number;
}

export interface FactorRow {
  factor:     string;
  rows:       number;
  baseBrier:  number;
  adjBrier:   number;
  delta:      number;
}

export interface EdgeBucketRow {
  label:         string;
  minEdge:       number;
  maxEdge:       number;
  n:             number;
  avgPredicted:  number;
  actualHitRate: number;
}

export interface CalibrationBucket {
  bucket:    string;
  n:         number;
  predicted: number;
  actual:    number;
  gap:       number;
}

export interface BacktestResult {
  runAt:               string;
  series:              number;
  predictions:         number;
  summary:             { base: SummaryMetrics; adjusted: SummaryMetrics; brierDelta: number };
  perStat:             StatRow[];
  perSport:            SportRow[];
  perFactor:           FactorRow[];
  perEdgeBucket:       EdgeBucketRow[];
  calibrationBuckets:  CalibrationBucket[];
}

// ── main engine ──────────────────────────────────────────────────────────────

export async function runBacktest(): Promise<BacktestResult> {
  const rows = await db
    .select({
      playerId:  playerGameLogsTable.playerId,
      statType:  playerGameLogsTable.statType,
      gameDate:  playerGameLogsTable.gameDate,
      value:     playerGameLogsTable.value,
      homeAway:  playerGameLogsTable.homeAway,
      sport:     playersTable.sport,
    })
    .from(playerGameLogsTable)
    .leftJoin(playersTable, eq(playerGameLogsTable.playerId, playersTable.id))
    .orderBy(
      asc(playerGameLogsTable.playerId),
      asc(playerGameLogsTable.statType),
      asc(playerGameLogsTable.gameDate),
    );

  type LogRow = { gameDate: string; value: number; homeAway: string | null };

  const series = new Map<string, { statType: string; sport: string; logs: LogRow[] }>();
  for (const r of rows) {
    const key = `${r.playerId}::${r.statType}`;
    const existing = series.get(key);
    const logs = existing?.logs ?? [];
    logs.push({ gameDate: r.gameDate, value: Number(r.value), homeAway: r.homeAway });
    series.set(key, { statType: r.statType, sport: r.sport ?? "Unknown", logs });
  }

  const base     = new StatsAccum();
  const adjusted = new StatsAccum();

  const perFactor = new Map<string, { base: StatsAccum; adj: StatsAccum }>();
  const ensureFactor = (k: string) => {
    let f = perFactor.get(k);
    if (!f) { f = { base: new StatsAccum(), adj: new StatsAccum() }; perFactor.set(k, f); }
    return f;
  };

  const perStat  = new Map<string, StatsAccum>();
  const perSport = new Map<string, StatsAccum>();
  const ensureStat  = (st: string) => { let s = perStat.get(st);  if (!s) { s = new StatsAccum(); perStat.set(st, s); }  return s; };
  const ensureSport = (sp: string) => { let s = perSport.get(sp); if (!s) { s = new StatsAccum(); perSport.set(sp, s); } return s; };

  const edgeBuckets: EdgeBucketAccum[] = EDGE_LABELS.map(() => ({ n: 0, predSum: 0, hits: 0 }));

  let seriesUsed  = 0;
  let predictions = 0;

  for (const [, { statType, sport, logs }] of series) {
    if (logs.length < MIN_PRIOR + 1) continue;
    seriesUsed++;

    for (let i = MIN_PRIOR; i < logs.length; i++) {
      const prior     = logs.slice(0, i);
      const cur       = logs[i];
      const priorVals = prior.map((p) => p.value);

      const mu = mean(priorVals);
      if (mu <= 0) continue;
      const std        = Math.max(sampleStd(priorVals, mu), mu * STD_FLOOR_PCT);
      const line       = median(priorVals);
      const actualOver = cur.value > line;

      const basePOver01 = pOverLineDist(mu, std, line, statType) / 100;
      base.add(basePOver01, actualOver);
      ensureStat(statType).add(basePOver01, actualOver);
      ensureSport(sport).add(basePOver01, actualOver);

      // edge bucket
      const ei = edgeBucketIndex(basePOver01);
      edgeBuckets[ei].n++;
      edgeBuckets[ei].predSum += basePOver01;
      if ((basePOver01 > 0.5) === actualOver) edgeBuckets[ei].hits++;

      // factor engine
      const prevDate      = prior[prior.length - 1].gameDate;
      const daysRest      = daysBetween(prevDate, cur.gameDate);
      const isBackToBack  = daysRest <= 1;
      const windowStart   = new Date(cur.gameDate).getTime() - 3 * 86_400_000;
      const gamesInWindow =
        1 + prior.filter((p) => new Date(p.gameDate).getTime() >= windowStart).length;
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

      const { combinedFactor, applied: appliedFactors } = combineFactors(applied);
      const adjPOver01 = pOverLineDist(mu * combinedFactor, std, line, statType) / 100;
      adjusted.add(adjPOver01, actualOver);

      for (const f of appliedFactors) {
        const solo       = combineFactors([f]).combinedFactor;
        const soloPOver  = pOverLineDist(mu * solo, std, line, statType) / 100;
        const slot       = ensureFactor(f.key);
        slot.base.add(basePOver01, actualOver);
        slot.adj.add(soloPOver, actualOver);
      }

      predictions++;
    }
  }

  const statRows: StatRow[] = [...perStat.entries()]
    .filter(([, s]) => s.n >= MIN_STAT_N)
    .sort((a, b) => b[1].brier() - a[1].brier())
    .map(([statType, s]) => ({
      statType,
      n:           s.n,
      brier:       round4(s.brier()),
      confHitRate: round4(s.hitRate()),
      ece:         round4(s.ece()),
      maxCalError: round4(s.maxCalError()),
    }));

  const sportRows: SportRow[] = [...perSport.entries()]
    .filter(([, s]) => s.n >= MIN_SPORT_N)
    .sort((a, b) => b[1].brier() - a[1].brier())
    .map(([sport, s]) => ({
      sport,
      n:           s.n,
      brier:       round4(s.brier()),
      confHitRate: round4(s.hitRate()),
      ece:         round4(s.ece()),
      maxCalError: round4(s.maxCalError()),
    }));

  const factorRows: FactorRow[] = [...perFactor.entries()].map(([factor, { base: b, adj: a }]) => ({
    factor,
    rows:      b.n,
    baseBrier: round4(b.brier()),
    adjBrier:  round4(a.brier()),
    delta:     round4(b.brier() - a.brier()),
  }));

  const edgeBucketRows: EdgeBucketRow[] = EDGE_LABELS.map((label, i) => {
    const eb = edgeBuckets[i];
    return {
      label,
      minEdge:       EDGE_BREAKPOINTS[i],
      maxEdge:       i + 1 < EDGE_BREAKPOINTS.length ? EDGE_BREAKPOINTS[i + 1] : 1.0,
      n:             eb.n,
      avgPredicted:  eb.n ? round4(eb.predSum / eb.n) : 0,
      actualHitRate: eb.n ? round4(eb.hits / eb.n) : 0,
    };
  });

  return {
    runAt:              new Date().toISOString(),
    series:             seriesUsed,
    predictions,
    summary: {
      base:       base.toSummaryMetrics(),
      adjusted:   adjusted.toSummaryMetrics(),
      brierDelta: round4(base.brier() - adjusted.brier()),
    },
    perStat:            statRows,
    perSport:           sportRows,
    perFactor:          factorRows,
    perEdgeBucket:      edgeBucketRows,
    calibrationBuckets: base.calibrationBuckets(),
  };
}
