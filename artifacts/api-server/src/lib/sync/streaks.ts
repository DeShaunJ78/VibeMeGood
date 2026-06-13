import { db } from "@workspace/db";
import {
  playerGameLogsTable, ppLinesTable, playersTable, playerStreaksTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { logger } from "../logger";

/**
 * Compute hit streaks for every active player×statType combination.
 *
 * Rewritten to bulk-fetch all game logs up-front (chunked IN clause) and
 * batch-upsert results, replacing the original N+1 pattern that timed out
 * production DB connections when the active-line pool exceeded ~1k rows.
 */
export async function computeStreaks(): Promise<number> {
  const activeLines = await db
    .select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(and(
      eq(ppLinesTable.isActive, true),
      eq(ppLinesTable.pickCategory, "player"),
    ));

  // Deduplicate player×statType (a player can have multiple line tiers)
  const seen = new Set<string>();
  const unique = activeLines.filter(r => {
    const key = `${r.line.playerId}:${r.line.statType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    logger.info({ computed: 0 }, "computeStreaks done");
    return 0;
  }

  // ── 1. Bulk-fetch game logs for all players in chunks of 1000 ───────────
  const playerIds = [...new Set(unique.map(r => r.player.id))];
  const CHUNK = 1000;

  const allLogs: {
    playerId: number;
    statType: string;
    value: string;
    gameDate: string;
  }[] = [];

  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const rows = await db
      .select({
        playerId:  playerGameLogsTable.playerId,
        statType:  playerGameLogsTable.statType,
        value:     playerGameLogsTable.value,
        gameDate:  playerGameLogsTable.gameDate,
      })
      .from(playerGameLogsTable)
      .where(inArray(playerGameLogsTable.playerId, chunk))
      .orderBy(desc(playerGameLogsTable.gameDate));
    for (const row of rows) allLogs.push(row);
  }

  // ── 2. Index logs by "playerId:statType" → values (most-recent first) ───
  const logsByKey = new Map<string, string[]>();
  for (const gl of allLogs) {
    const key = `${gl.playerId}:${gl.statType}`;
    if (!logsByKey.has(key)) logsByKey.set(key, []);
    logsByKey.get(key)!.push(gl.value);
  }

  // ── 3. Compute streaks in memory ─────────────────────────────────────────
  const upserts: (typeof playerStreaksTable.$inferInsert)[] = [];

  for (const { line, player } of unique) {
    const key   = `${player.id}:${line.statType}`;
    const logs  = logsByKey.get(key) ?? [];
    if (logs.length === 0) continue;

    const currentLine = parseFloat(line.lineValue.toString());
    let streakCount = 0;
    let streakType: "over" | "under" | null = null;

    for (const rawVal of logs) {
      const val    = parseFloat(rawVal.toString());
      const isOver = val > currentLine;

      if (streakType === null) {
        streakType  = isOver ? "over" : "under";
        streakCount = 1;
      } else if ((streakType === "over" && isOver) || (streakType === "under" && !isOver)) {
        streakCount++;
      } else {
        break;
      }
    }

    upserts.push({
      playerId:      player.id,
      statType:      line.statType,
      currentStreak: streakCount,
      streakType:    streakType ?? "over",
      updatedAt:     new Date(),
    });
  }

  // ── 4. Batch-upsert in chunks of 500 ─────────────────────────────────────
  const UPSERT_CHUNK = 500;
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    await db
      .insert(playerStreaksTable)
      .values(upserts.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [playerStreaksTable.playerId, playerStreaksTable.statType],
        set: {
          currentStreak: sql`excluded.current_streak`,
          streakType:    sql`excluded.streak_type`,
          updatedAt:     sql`excluded.updated_at`,
        },
      });
  }

  logger.info({ computed: upserts.length }, "computeStreaks done");
  return upserts.length;
}
