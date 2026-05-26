import { db } from "@workspace/db";
import {
  playersTable, ppLinesTable, ourProjectionsTable, playerGameLogsTable,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../logger";
import { scrapeNHLStats, scrapeMLBStats, type ScrapedProjection } from "./fp-scraper";
import { matchPlayer, type PlayerRef } from "./name-match";
import { pOverLine, percentileAtLine } from "../projection/normal-dist";
import { getPrior } from "../projection/priors";
import { recalcPropScores } from "../sync/external-odds";

export interface SyncResult {
  sport: string;
  scraped: number;
  matched: number;
  upserted: number;
  samples: Array<{ player: string; statType: string; projectedValue: number }>;
}

async function upsertProjection(
  playerId: number,
  statType: string,
  projectedValue: number,
  sourceLabel: string,
  sport: string,
): Promise<void> {
  const [ppLine] = await db
    .select({ lineValue: ppLinesTable.lineValue, lineType: ppLinesTable.lineType })
    .from(ppLinesTable)
    .where(and(
      eq(ppLinesTable.playerId, playerId),
      eq(ppLinesTable.statType, statType),
      eq(ppLinesTable.isActive, true),
    ))
    .limit(1);

  const [existing] = await db
    .select()
    .from(ourProjectionsTable)
    .where(and(
      eq(ourProjectionsTable.playerId, playerId),
      eq(ourProjectionsTable.statType, statType),
    ))
    .limit(1);

  const prior = getPrior(sport, statType);
  const stdDev = existing?.stdDev ? parseFloat(existing.stdDev.toString()) : prior.std;
  const ppLineVal = ppLine ? parseFloat(ppLine.lineValue.toString()) : projectedValue;

  const pOver    = pOverLine(projectedValue, stdDev, ppLineVal);
  const pctAtLine = percentileAtLine(projectedValue, stdDev, ppLineVal);
  const deviation = Math.abs(projectedValue - prior.mean) / Math.max(prior.std, 0.1);
  const confidence =
    deviation > 1.5 ? "high" :
    deviation > 0.5 ? "medium" : "low";

  const payload = {
    playerId,
    statType,
    projectedValue:   projectedValue.toString(),
    weightedAvg:      projectedValue.toString(),
    stdDev:           stdDev.toString(),
    pOver:            (Math.round(pOver * 10) / 10).toString(),
    percentileAtLine: (Math.round(pctAtLine * 10) / 10).toString(),
    confidence,
    sourceLabel,
    modelVersion:     "stats_scrape",
    dataQualityScore: 70,
    noPlayReason:     null,
    expiresAt:        new Date(Date.now() + 12 * 60 * 60 * 1000),
    generatedAt:      new Date(),
  };

  if (existing) {
    await db.update(ourProjectionsTable).set(payload).where(eq(ourProjectionsTable.id, existing.id));
  } else {
    await db.insert(ourProjectionsTable).values(payload);
  }
}

async function syncFromScraped(
  sport: string,
  scraped: ScrapedProjection[],
  players: PlayerRef[],
): Promise<SyncResult> {
  const sportPlayers = players.filter(p => p.sport === sport);
  let matched = 0, upserted = 0;
  const samples: SyncResult["samples"] = [];

  const byPlayer = new Map<string, ScrapedProjection[]>();
  for (const p of scraped) {
    const arr = byPlayer.get(p.playerName) ?? [];
    arr.push(p);
    byPlayer.set(p.playerName, arr);
  }

  for (const [name, prows] of byPlayer) {
    const playerRef = matchPlayer(name, sportPlayers);
    if (!playerRef) continue;
    matched++;

    for (const p of prows) {
      try {
        await upsertProjection(playerRef.id, p.statType, p.projectedValue, p.source, sport);
        upserted++;
        if (samples.length < 5) {
          samples.push({ player: playerRef.fullName, statType: p.statType, projectedValue: p.projectedValue });
        }
      } catch (err) {
        logger.warn({ err, player: name, statType: p.statType }, "Projection upsert failed");
      }
    }
  }

  logger.info({ sport, scraped: scraped.length, matched, upserted }, "Sport projection sync complete");
  return { sport, scraped: scraped.length, matched, upserted, samples };
}

// NBA: derive projections from our own game logs (season averages)
async function syncNBAFromGameLogs(players: PlayerRef[]): Promise<SyncResult> {
  const nbaPlayers = players.filter(p => p.sport === "NBA");
  const playerIdSet = new Set(nbaPlayers.map(p => p.id));

  // Get recent per-player per-stat averages from game logs
  const rows = await db
    .select({
      playerId:   playerGameLogsTable.playerId,
      statType:   playerGameLogsTable.statType,
      avgValue:   sql<number>`ROUND(AVG(${playerGameLogsTable.value}::numeric), 2)`,
      gamesUsed:  sql<number>`COUNT(*)`,
    })
    .from(playerGameLogsTable)
    .groupBy(playerGameLogsTable.playerId, playerGameLogsTable.statType)
    .having(sql`COUNT(*) >= 3`);

  // Only keep NBA players we know about
  const nbaRows = rows.filter(r => r.playerId != null && playerIdSet.has(r.playerId as number));

  let upserted = 0;
  const samples: SyncResult["samples"] = [];
  const playerMap = new Map(nbaPlayers.map(p => [p.id, p]));

  for (const row of nbaRows) {
    const pid = row.playerId as number;
    const val = Number(row.avgValue);
    if (!pid || isNaN(val)) continue;

    try {
      await upsertProjection(pid, row.statType, val, "game_log_avg", "NBA");
      upserted++;
      if (samples.length < 5) {
        const player = playerMap.get(pid);
        if (player) samples.push({ player: player.fullName, statType: row.statType, projectedValue: val });
      }
    } catch (err) {
      logger.warn({ err, playerId: pid, statType: row.statType }, "NBA game-log upsert failed");
    }
  }

  logger.info({ rows: nbaRows.length, upserted }, "NBA game-log projections synced");
  return { sport: "NBA", scraped: nbaRows.length, matched: nbaRows.length, upserted, samples };
}

export async function syncProjections(sport?: string): Promise<SyncResult[]> {
  const allPlayers = await db
    .select({ id: playersTable.id, fullName: playersTable.fullName, sport: playersTable.sport })
    .from(playersTable);

  const sportUpper = sport?.toUpperCase();
  const results: SyncResult[] = [];

  // Run sport syncs in parallel
  const tasks: Promise<SyncResult>[] = [];

  if (!sportUpper || sportUpper === "NHL") {
    tasks.push(
      scrapeNHLStats().then(scraped => syncFromScraped("NHL", scraped, allPlayers)),
    );
  }
  if (!sportUpper || sportUpper === "MLB") {
    tasks.push(
      scrapeMLBStats().then(scraped => syncFromScraped("MLB", scraped, allPlayers)),
    );
  }
  if (!sportUpper || sportUpper === "NBA") {
    tasks.push(syncNBAFromGameLogs(allPlayers));
  }

  const settled = await Promise.allSettled(tasks);
  for (const r of settled) {
    if (r.status === "fulfilled") results.push(r.value);
    else logger.error({ err: r.reason }, "Sport sync task failed");
  }

  try {
    await recalcPropScores();
  } catch (err) {
    logger.warn({ err }, "recalcPropScores after projection sync failed");
  }

  return results;
}
