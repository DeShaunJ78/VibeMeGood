/**
 * Walk-forward backtest CLI.
 *
 * Runs the backtest engine, writes the result to the database, and prints
 * a pretty summary to stdout.
 *
 * Run:  pnpm --filter @workspace/api-server run backtest
 */

import { db } from "@workspace/db";
import { backtestResultsTable } from "@workspace/db/schema";
import { runBacktest } from "../lib/projection/backtest-engine.js";

function pct(x: number): string {
  return isNaN(x) ? "   n/a" : (x * 100).toFixed(1).padStart(5) + "%";
}
function num(x: number): string {
  return isNaN(x) ? "n/a" : x.toFixed(4);
}

async function main() {
  console.log("Loading player game logs…");
  const result = await runBacktest();

  // ── persist to DB ──────────────────────────────────────────────────────────
  await db.insert(backtestResultsTable).values({
    series:      result.series,
    predictions: result.predictions,
    result:      result as unknown as Record<string, unknown>,
  });

  if (result.predictions === 0) {
    console.log("\nNo predictions produced — game-log history is too short to replay.");
    console.log("Seed/sync more player_game_logs and re-run.");
    return;
  }

  const b = result.summary.base;
  const a = result.summary.adjusted;

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(" WALK-FORWARD BACKTEST");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`series used: ${result.series}   predictions: ${result.predictions}   (min prior=${5})`);

  console.log("\n── Overall accuracy ──");
  console.log(`                Brier    Conf-HR (|p-0.5|≥0.1)   ECE     MaxCalErr`);
  console.log(`base model      ${num(b.brier)}   ${pct(b.confHitRate)}  (n=${b.confidentN})   ${pct(b.ece)}  ${pct(b.maxCalError)}`);
  console.log(`+ factors       ${num(a.brier)}   ${pct(a.confHitRate)}  (n=${a.confidentN})   ${pct(a.ece)}  ${pct(a.maxCalError)}`);
  console.log(`Brier delta     ${result.summary.brierDelta >= 0 ? "+" : ""}${num(result.summary.brierDelta)}  (${result.summary.brierDelta >= 0 ? "improvement" : "REGRESSION"})`);

  console.log("\n── Calibration (base model): predicted vs empirical over-rate ──");
  console.log("bucket   n     pred    actual  gap");
  for (const cb of result.calibrationBuckets) {
    console.log(
      `${cb.bucket.padEnd(8)}` +
      `  ${cb.n.toString().padStart(5)}` +
      `  ${pct(cb.predicted)}  ${pct(cb.actual)}` +
      `  ${cb.gap >= 0 ? "+" : ""}${(cb.gap * 100).toFixed(1).padStart(5)}pp`,
    );
  }

  console.log(`\n── Per-stat breakdown (base model, n≥50, worst Brier first) ──`);
  console.log("stat-type                     n    Brier   Conf-HR   ECE    MaxCalErr");
  for (const s of result.perStat) {
    console.log(
      `${s.statType.padEnd(28)}  ${s.n.toString().padStart(5)}  ${num(s.brier)}` +
      `  ${pct(s.confHitRate)}  ${pct(s.ece)}  ${pct(s.maxCalError)}`,
    );
  }

  console.log("\n── Per-sport breakdown (base model) ──");
  console.log("sport     n      Brier   Conf-HR   ECE    MaxCalErr");
  for (const s of result.perSport) {
    console.log(
      `${s.sport.padEnd(8)}  ${s.n.toString().padStart(6)}  ${num(s.brier)}` +
      `  ${pct(s.confHitRate)}  ${pct(s.ece)}  ${pct(s.maxCalError)}`,
    );
  }

  console.log("\n── Edge bucket: do bigger edges actually win? ──");
  console.log("edge       n      avg-pred  hit-rate");
  for (const e of result.perEdgeBucket) {
    console.log(
      `${e.label.padEnd(9)}  ${e.n.toString().padStart(6)}  ${pct(e.avgPredicted)}   ${pct(e.actualHitRate)}`,
    );
  }

  console.log("\n── Per-factor marginal lift (only rows where factor applied) ──");
  console.log("factor        rows    base Brier   +factor Brier   delta");
  for (const f of result.perFactor) {
    const delta = f.delta;
    console.log(
      `${f.factor.padEnd(12)}  ${f.rows.toString().padStart(5)}   ${num(f.baseBrier)}      ${num(f.adjBrier)}      ${delta >= 0 ? "+" : ""}${num(delta)}`,
    );
  }

  console.log("\n── Factors NOT evaluable from game logs alone ──");
  console.log("pace, dvp, impliedTotal, weather, nflAdvanced — need external context.");
  console.log("══════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
