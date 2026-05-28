import { db } from "@workspace/db";
import {
  playerGameLogsTable,
  matchupHistoryTable,
} from "@workspace/db/schema";
import { isNotNull } from "drizzle-orm";
import { logger } from "../logger";

export async function computeMatchupHistory(): Promise<number> {
  const logs = await db
    .select({
      playerId: playerGameLogsTable.playerId,
      statType: playerGameLogsTable.statType,
      value: playerGameLogsTable.value,
      opponentTeamId: playerGameLogsTable.opponentTeamId,
    })
    .from(playerGameLogsTable)
    .where(isNotNull(playerGameLogsTable.opponentTeamId));

  const groups = new Map<string, {
    playerId: number;
    opponentTeamId: number;
    statType: string;
    values: number[];
  }>();

  for (const log of logs) {
    if (!log.opponentTeamId || !log.playerId) continue;
    const key = `${log.playerId}:${log.opponentTeamId}:${log.statType}`;
    if (!groups.has(key)) {
      groups.set(key, {
        playerId: log.playerId,
        opponentTeamId: log.opponentTeamId,
        statType: log.statType,
        values: [],
      });
    }
    groups.get(key)!.values.push(Number(log.value));
  }

  let upserted = 0;
  for (const group of groups.values()) {
    if (group.values.length < 3) continue;
    const avg =
      group.values.reduce((a, b) => a + b, 0) / group.values.length;

    await db
      .insert(matchupHistoryTable)
      .values({
        playerId: group.playerId,
        opponentTeamId: group.opponentTeamId,
        statType: group.statType,
        gamesPlayed: group.values.length,
        avgValue: avg.toFixed(2),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          matchupHistoryTable.playerId,
          matchupHistoryTable.opponentTeamId,
          matchupHistoryTable.statType,
        ],
        set: {
          gamesPlayed: group.values.length,
          avgValue: avg.toFixed(2),
          updatedAt: new Date(),
        },
      });
    upserted++;
  }

  logger.info({ upserted }, "Matchup history computed");
  return upserted;
}
