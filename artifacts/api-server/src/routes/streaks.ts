import { Router } from "express";
import { db } from "@workspace/db";
import { playerStreaksTable, playersTable, teamsTable, ppLinesTable } from "@workspace/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";

const router = Router();

router.get("/streaks", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        streakId:       playerStreaksTable.id,
        currentStreak:  playerStreaksTable.currentStreak,
        streakType:     playerStreaksTable.streakType,
        updatedAt:      playerStreaksTable.updatedAt,
        playerId:       playersTable.id,
        playerName:     playersTable.fullName,
        imageUrl:       playersTable.imageUrl,
        sport:          playersTable.sport,
        statType:       playerStreaksTable.statType,
        teamAbbr:       teamsTable.abbreviation,
      })
      .from(playerStreaksTable)
      .innerJoin(playersTable, eq(playerStreaksTable.playerId, playersTable.id))
      .leftJoin(teamsTable, eq(playersTable.teamId, teamsTable.id))
      .where(sql`abs(${playerStreaksTable.currentStreak}) >= 1`)
      .orderBy(desc(sql`abs(${playerStreaksTable.currentStreak})`));

    const linesByPlayer: Record<number, string | null> = {};
    for (const r of rows) {
      if (r.playerId in linesByPlayer) continue;
      const [line] = await db
        .select({ lineValue: ppLinesTable.lineValue })
        .from(ppLinesTable)
        .where(and(eq(ppLinesTable.playerId, r.playerId), eq(ppLinesTable.isActive, true)))
        .limit(1);
      linesByPlayer[r.playerId] = line?.lineValue ?? null;
    }

    const streaks = rows.map(r => ({
      streakId:      r.streakId,
      playerId:      r.playerId,
      playerName:    r.playerName,
      imageUrl:      r.imageUrl ?? null,
      team:          r.teamAbbr ?? null,
      sport:         r.sport,
      statType:      r.statType,
      currentStreak: r.currentStreak ?? 0,
      streakType:    r.streakType,
      streakLength:  Math.abs(r.currentStreak ?? 0),
      todaysLine:    linesByPlayer[r.playerId] ?? null,
      updatedAt:     r.updatedAt,
    }));

    res.json(streaks);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
