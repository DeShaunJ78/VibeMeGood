import { Router } from "express";
import { db } from "@workspace/db";
import { matchupHistoryTable, playersTable, teamsTable, ppLinesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

// Two aliases for the teams table — one for the player's team, one for opponent
const playerTeams   = teamsTable;
const opponentTeams = teamsTable;

router.get("/matchup", async (req, res): Promise<void> => {
  try {
    const activeLines = await db
      .select({
        playerId:    ppLinesTable.playerId,
        statType:    ppLinesTable.statType,
        lineValue:   ppLinesTable.lineValue,
        lineType:    ppLinesTable.lineType,
        playerName:  playersTable.fullName,
        sport:       playersTable.sport,
        teamAbbr:    teamsTable.abbreviation,
      })
      .from(ppLinesTable)
      .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
      .leftJoin(teamsTable,    eq(playersTable.teamId, teamsTable.id))
      .where(eq(ppLinesTable.isActive, true));

    const results = [];
    const seen = new Set<string>();

    for (const line of activeLines) {
      if (!line.playerId) continue;
      const key = `${line.playerId}-${line.statType}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const histories = await db
        .select({
          histId:                matchupHistoryTable.id,
          opponentTeamId:        matchupHistoryTable.opponentTeamId,
          gamesPlayed:           matchupHistoryTable.gamesPlayed,
          avgValue:              matchupHistoryTable.avgValue,
          overRateAtCurrentLine: matchupHistoryTable.overRateAtCurrentLine,
          updatedAt:             matchupHistoryTable.updatedAt,
          opponentName:          teamsTable.name,
          opponentAbbr:          teamsTable.abbreviation,
        })
        .from(matchupHistoryTable)
        .innerJoin(teamsTable, eq(matchupHistoryTable.opponentTeamId, teamsTable.id))
        .where(
          and(
            eq(matchupHistoryTable.playerId, line.playerId),
            eq(matchupHistoryTable.statType, line.statType),
          )
        );

      results.push({
        playerId:   line.playerId,
        playerName: line.playerName,
        team:       line.teamAbbr ?? null,
        sport:      line.sport,
        statType:   line.statType,
        lineValue:  line.lineValue,
        lineType:   line.lineType,
        matchups:   histories,
      });
    }

    results.sort((a, b) => b.matchups.length - a.matchups.length);
    res.json(results);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
