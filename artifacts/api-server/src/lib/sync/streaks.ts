import { db } from "@workspace/db";
import {
  playerGameLogsTable, ppLinesTable, playersTable, playerStreaksTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../logger";

/**
 * Compute hit streaks for every active player×statType combination.
 * A "hit" is when the player's actual value exceeded the current PP line.
 * Streak resets on the first game that breaks the direction.
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

  // Deduplicate player×statType (a player can have multiple lines per stat)
  const seen = new Set<string>();
  const unique = activeLines.filter(r => {
    const key = `${r.line.playerId}:${r.line.statType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let computed = 0;

  for (const { line, player } of unique) {
    const logs = await db
      .select()
      .from(playerGameLogsTable)
      .where(and(
        eq(playerGameLogsTable.playerId, player.id),
        eq(playerGameLogsTable.statType, line.statType),
      ))
      .orderBy(desc(playerGameLogsTable.gameDate))
      .limit(20);

    if (logs.length === 0) continue;

    const currentLine = parseFloat(line.lineValue.toString());

    // Walk from most recent → oldest, count consecutive same-direction games
    let streakCount = 0;
    let streakType: "over" | "under" | null = null;

    for (const log of logs) {
      const val = parseFloat(log.value.toString());
      const isOver = val > currentLine;

      if (streakType === null) {
        streakType = isOver ? "over" : "under";
        streakCount = 1;
      } else if ((streakType === "over" && isOver) || (streakType === "under" && !isOver)) {
        streakCount++;
      } else {
        break;
      }
    }

    await db
      .insert(playerStreaksTable)
      .values({
        playerId: player.id,
        statType: line.statType,
        currentStreak: streakCount,
        streakType: streakType ?? "over",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [playerStreaksTable.playerId, playerStreaksTable.statType],
        set: {
          currentStreak: streakCount,
          streakType: streakType ?? "over",
          updatedAt: new Date(),
        },
      });

    computed++;
  }

  logger.info({ computed }, "computeStreaks done");
  return computed;
}
