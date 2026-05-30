import { db } from "@workspace/db";
import {
  ppLinesTable, playerGameLogsTable, gamesTable, playersTable,
  probabilityCalibrationTable,
} from "@workspace/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { computeProjection } from "../lib/projection/compute";
import { logger } from "../lib/logger";

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
  totalLines: number;
  examplesProcessed: number;
  calibrationRecords: number;
  mae: number | null;
}

function normalizeSport(s: string): string {
  if (s.startsWith("NBA"))  return "NBA";
  if (s.startsWith("MLB"))  return "MLB";
  if (s.startsWith("NHL"))  return "NHL";
  if (s.startsWith("NFL"))  return "NFL";
  if (s.startsWith("WNBA")) return "WNBA";
  return s;
}

function getEdgeBucket(edgePct: number): string {
  if (edgePct < 5)  return "0-5";
  if (edgePct < 10) return "5-10";
  if (edgePct < 15) return "10-15";
  if (edgePct < 20) return "15-20";
  if (edgePct < 25) return "20-25";
  return "25+";
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const calibrationJob = {
  async runHistoricalCalibration(limit = 5000): Promise<CalibrationResult> {
    // 1. Fetch historical lines (inactive) that have a linked game
    const historicalLines = await db
      .select({
        id:        ppLinesTable.id,
        playerId:  ppLinesTable.playerId,
        gameId:    ppLinesTable.gameId,
        statType:  ppLinesTable.statType,
        lineValue: ppLinesTable.lineValue,
        lineType:  ppLinesTable.lineType,
      })
      .from(ppLinesTable)
      .where(and(
        eq(ppLinesTable.isActive, false),
        isNotNull(ppLinesTable.gameId),
      ))
      .limit(limit);

    const totalLines = historicalLines.length;
    logger.info({ totalLines }, "Calibration: historical lines fetched");

    const buckets = new Map<string, CalibrationBucket>();
    const maeAccum: number[] = [];
    let examplesProcessed = 0;

    for (const line of historicalLines) {
      try {
        if (!line.gameId) continue;

        // 2. Resolve game → get startTime date
        const [game] = await db
          .select({
            startTime:   gamesTable.startTime,
            homeTeamId:  gamesTable.homeTeamId,
            awayTeamId:  gamesTable.awayTeamId,
          })
          .from(gamesTable)
          .where(eq(gamesTable.id, line.gameId))
          .limit(1);

        if (!game) continue;

        const gameDateStr = toDateStr(game.startTime);

        // 3. Find the matching player game log on that calendar date
        const [gameLog] = await db
          .select({
            value:          playerGameLogsTable.value,
            opponentTeamId: playerGameLogsTable.opponentTeamId,
          })
          .from(playerGameLogsTable)
          .where(and(
            eq(playerGameLogsTable.playerId, line.playerId),
            eq(playerGameLogsTable.statType, line.statType),
            eq(playerGameLogsTable.gameDate, gameDateStr),
          ))
          .limit(1);

        if (!gameLog) continue;

        // 4. Get player sport
        const [player] = await db
          .select({ sport: playersTable.sport })
          .from(playersTable)
          .where(eq(playersTable.id, line.playerId))
          .limit(1);

        if (!player) continue;

        const sport = normalizeSport(player.sport);
        const ppLine      = parseFloat(line.lineValue.toString());
        const actualValue = parseFloat(gameLog.value.toString());

        // 5. Run the projection model at the game's line + context
        const proj = await computeProjection(
          line.playerId,
          line.statType,
          ppLine,
          line.lineType,
          sport,
          gameLog.opponentTeamId ?? undefined,
        );

        // Skip prior_only rows — no real model signal to calibrate
        if (proj.sourceLabel === "prior_only") continue;

        const pOver    = proj.pOver;                   // 0–100
        const edgePct  = Math.abs(pOver - 50);
        const direction = pOver >= 50 ? "over" : "under";
        const edgeBucket = getEdgeBucket(edgePct);

        const actualOutcome = actualValue > ppLine ? "over" : "under";
        const hit = direction === actualOutcome ? 1 : 0;

        // MAE: |P(model direction) – actual|
        const predictedProb = direction === "over" ? pOver / 100 : (100 - pOver) / 100;
        maeAccum.push(Math.abs(predictedProb - hit));

        // Accumulate into bucket
        const key = `${sport}|${line.statType}|${line.lineType}|${edgeBucket}|${direction}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.sampleSize++;
          existing.hitCount += hit;
        } else {
          buckets.set(key, {
            sport,
            statType:   line.statType,
            lineType:   line.lineType,
            edgeBucket,
            direction,
            sampleSize: 1,
            hitCount:   hit,
          });
        }

        examplesProcessed++;
      } catch (e) {
        logger.warn({ err: e, lineId: line.id }, "Calibration: line skipped");
      }
    }

    // 6. Upsert calibration records
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

    logger.info({ totalLines, examplesProcessed, calibrationRecords, mae }, "Calibration complete");

    return { totalLines, examplesProcessed, calibrationRecords, mae };
  },
};
