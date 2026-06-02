/**
 * Probability calibration builder.
 *
 * The production model emits a raw P(over) from a normal-CDF on the projected
 * mean/std. Raw normal tails are too thin, so the model is over-confident. This
 * job measures the EMPIRICAL hit rate the model actually achieves at each
 * confidence level, so `calibratePOver` can blend the raw probability toward
 * reality.
 *
 * Data source: we replay every player+statType game-log series chronologically
 * (walk-forward, prior games only — no leakage), exactly like the backtest. At
 * each game we build a base projection from the prior window, evaluate its
 * P(over) against a pseudo-line (trailing median, a proxy for where books set
 * lines), and compare the model's direction to the actual outcome.
 *
 * We bucket by (sport, statType, lineType, edgeBucket, direction) and store the
 * empirical hit rate per bucket. We only have settled outcomes in
 * `player_game_logs`, and historical PrizePicks lines are not linkable to those
 * outcomes (the only lines carrying a gameId point at unplayed slate games), so
 * the pseudo-line replay is the honest source. We calibrate the "standard" line
 * tier only; goblin/demon lines have no historical reconstruction and safely
 * fall through to the raw probability at runtime.
 *
 * Run:  pnpm --filter @workspace/api-server run calibrate
 */

import { db } from "@workspace/db";
import { playerGameLogsTable, playersTable, probabilityCalibrationTable } from "@workspace/db/schema";
import { asc } from "drizzle-orm";
import { pOverLineDist } from "../lib/projection/distributions.js";
import { getEdgeBucket, normalizeSport } from "../lib/projection/calibration";
import { logger } from "../lib/logger";

const MIN_PRIOR = 5;        // need at least this many prior games to project
const STD_FLOOR_PCT = 0.1;  // floor sigma at 10% of mean so pOver isn't degenerate
// Tier-agnostic: a player's outcome distribution does not depend on the tier
// LABEL (standard/demon/goblin) — only on the line VALUE, which is already
// captured by edgeBucket. So we bucket under one "all" tier and every tier reads
// the same empirical curve (demon/goblin included), instead of leaving non-standard
// tiers uncalibrated.
const LINE_TYPE = "all";

interface CalibrationBucket {
  sport: string;
  statType: string;
  lineType: string;
  edgeBucket: string;
  direction: string;
  sampleSize: number;
  hitCount: number;
}

export interface CalibrationResult {
  totalLines: number;        // series replayed
  examplesProcessed: number; // individual predictions evaluated
  calibrationRecords: number;
  mae: number | null;
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

export const calibrationJob = {
  /**
   * @param seriesLimit optional cap on number of player+statType series to
   *   replay (for quick test runs); defaults to all series.
   */
  async runHistoricalCalibration(seriesLimit?: number): Promise<CalibrationResult> {
    // 1. Player → sport lookup (cheap, a few thousand rows)
    const players = await db
      .select({ id: playersTable.id, sport: playersTable.sport })
      .from(playersTable);
    const sportByPlayer = new Map<number, string>();
    for (const p of players) sportByPlayer.set(p.id, p.sport);

    // 2. Pull all settled game logs ordered for walk-forward replay
    const rows = await db
      .select({
        playerId: playerGameLogsTable.playerId,
        statType: playerGameLogsTable.statType,
        gameDate: playerGameLogsTable.gameDate,
        value: playerGameLogsTable.value,
      })
      .from(playerGameLogsTable)
      .orderBy(
        asc(playerGameLogsTable.playerId),
        asc(playerGameLogsTable.statType),
        asc(playerGameLogsTable.gameDate),
      );

    // group into series keyed by player+statType
    const series = new Map<string, { playerId: number; statType: string; values: number[] }>();
    for (const r of rows) {
      const key = `${r.playerId}::${r.statType}`;
      let s = series.get(key);
      if (!s) {
        s = { playerId: r.playerId, statType: r.statType, values: [] };
        series.set(key, s);
      }
      s.values.push(Number(r.value));
    }

    logger.info({ seriesCount: series.size }, "Calibration: game-log series built");

    const buckets = new Map<string, CalibrationBucket>();
    const maeAccum: number[] = [];
    let examplesProcessed = 0;
    let seriesUsed = 0;

    for (const s of series.values()) {
      if (seriesLimit != null && seriesUsed >= seriesLimit) break;
      if (s.values.length < MIN_PRIOR + 1) continue;

      const sport = normalizeSport(sportByPlayer.get(s.playerId) ?? "unknown");
      seriesUsed++;

      for (let i = MIN_PRIOR; i < s.values.length; i++) {
        const priorVals = s.values.slice(0, i);
        const curValue = s.values[i];

        const mu = mean(priorVals);
        if (mu <= 0) continue;
        const std = Math.max(sampleStd(priorVals, mu), mu * STD_FLOOR_PCT);
        // Pseudo-line: trailing median + 0.5 to avoid the "zero-median trap".
        // For sparse counting stats (Goals, RBIs, TDs, Walks, etc.) the raw
        // median is 0. Using median=0 as the line combined with the push-
        // exclusion below selectively removes every value=0 game — exactly the
        // "under" outcomes — leaving only value>0 games which trivially all hit
        // "over 0", producing a spurious 100% hit rate. Adding 0.5 mirrors how
        // PP actually sets counting-stat lines (0.5, 1.5, 2.5…) and ensures
        // integer values never equal the line, so the push exclusion is a no-op.
        const line = median(priorVals) + 0.5;

        // Exact ties are pushes (refund), not misses — exclude them so
        // non-integer real-valued stats don't bias the empirical hit rate.
        // With the +0.5 offset above, integer-valued stats never reach this path.
        if (curValue === line) continue;

        // Raw model probability — same distribution-aware function production uses.
        const pOver = pOverLineDist(mu, std, line, s.statType); // 0–100
        const edgePct = Math.abs(pOver - 50);
        const direction = pOver >= 50 ? "over" : "under";
        const edgeBucket = getEdgeBucket(edgePct);

        const actualOutcome = curValue > line ? "over" : "under";
        const hit = direction === actualOutcome ? 1 : 0;

        // MAE: |P(model direction) – actual|
        const predictedProb = direction === "over" ? pOver / 100 : (100 - pOver) / 100;
        maeAccum.push(Math.abs(predictedProb - hit));

        const key = `${sport}|${s.statType}|${LINE_TYPE}|${edgeBucket}|${direction}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.sampleSize++;
          existing.hitCount += hit;
        } else {
          buckets.set(key, {
            sport,
            statType: s.statType,
            lineType: LINE_TYPE,
            edgeBucket,
            direction,
            sampleSize: 1,
            hitCount: hit,
          });
        }

        examplesProcessed++;
      }
    }

    // 3. Upsert calibration records
    let calibrationRecords = 0;
    for (const bucket of buckets.values()) {
      const hitRate = bucket.sampleSize > 0 ? bucket.hitCount / bucket.sampleSize : 0;
      const ci = bucket.sampleSize > 0
        ? 1.96 * Math.sqrt((hitRate * (1 - hitRate)) / bucket.sampleSize)
        : null;

      await db
        .insert(probabilityCalibrationTable)
        .values({
          sport:              bucket.sport,
          statType:           bucket.statType,
          lineType:           bucket.lineType,
          edgeBucket:         bucket.edgeBucket,
          direction:          bucket.direction,
          sampleSize:         bucket.sampleSize,
          hitCount:           bucket.hitCount,
          hitRate:            hitRate.toFixed(4),
          confidenceInterval: ci != null ? ci.toFixed(4) : null,
          lastUpdated:        new Date(),
        })
        .onConflictDoUpdate({
          target: [
            probabilityCalibrationTable.sport,
            probabilityCalibrationTable.statType,
            probabilityCalibrationTable.lineType,
            probabilityCalibrationTable.edgeBucket,
            probabilityCalibrationTable.direction,
          ],
          set: {
            sampleSize:         bucket.sampleSize,
            hitCount:           bucket.hitCount,
            hitRate:            hitRate.toFixed(4),
            confidenceInterval: ci != null ? ci.toFixed(4) : null,
            lastUpdated:        new Date(),
          },
        });

      calibrationRecords++;
    }

    const mae = maeAccum.length > 0
      ? maeAccum.reduce((a, b) => a + b, 0) / maeAccum.length
      : null;

    logger.info(
      { seriesUsed, examplesProcessed, calibrationRecords, mae },
      "Calibration complete",
    );

    return { totalLines: seriesUsed, examplesProcessed, calibrationRecords, mae };
  },
};
