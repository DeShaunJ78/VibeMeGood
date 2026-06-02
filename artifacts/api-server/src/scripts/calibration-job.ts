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
import { pOverLine } from "../lib/projection/normal-dist";
import { getEdgeBucket, normalizeSport } from "../lib/projection/calibration";
import { logger } from "../lib/logger";

const MIN_PRIOR = 5;        // need at least this many prior games to project
const STD_FLOOR_PCT = 0.1;  // floor sigma at 10% of mean so pOver isn't degenerate
const LINE_TYPE = "standard"; // only tier we can reconstruct from logs

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
        const line = median(priorVals); // pseudo-line (book proxy)

        // Exact ties are pushes (refund), not misses — exclude them so integer
        // stats don't bias the empirical hit rate toward "under".
        if (curValue === line) continue;

        // Raw model probability — same core function production uses.
        const pOver = pOverLine(mu, std, line); // 0–100
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
