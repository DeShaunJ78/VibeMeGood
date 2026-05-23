import { Router } from "express";
import { db } from "@workspace/db";
import {
  gamesTable, injuriesTable, ppLinesTable, ppLineHistoryTable,
  propScoresTable, watchlistItemsTable, alertsTable, entriesTable,
  playersTable, teamsTable
} from "@workspace/db/schema";
import { eq, and, gte, desc, sql, inArray } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 86400000);

    const [todaysGames, recentInjuries, activeLines, watchlistCountResult, unreadAlertsResult, pendingEntriesResult] =
      await Promise.all([
        db.select().from(gamesTable)
          .where(and(gte(gamesTable.startTime, startOfToday), sql`${gamesTable.startTime} < ${endOfToday}`))
          .limit(20),
        db.select().from(injuriesTable).orderBy(desc(injuriesTable.reportedAt)).limit(8),
        db.select().from(ppLinesTable).where(eq(ppLinesTable.isActive, true)),
        db.select({ count: sql<number>`count(*)` }).from(watchlistItemsTable),
        db.select({ count: sql<number>`count(*)` }).from(alertsTable).where(eq(alertsTable.isRead, false)),
        db.select({ count: sql<number>`count(*)` }).from(entriesTable).where(eq(entriesTable.result, "pending")),
      ]);

    const lineIds = activeLines.map(l => l.id);
    const injuryPlayerIds = recentInjuries.map(i => i.playerId);
    const linePlayerIds = activeLines.map(l => l.playerId);
    const allPlayerIds = [...new Set([...linePlayerIds, ...injuryPlayerIds])];

    const [lineScores, allPlayers, allTeams, allHistory] = await Promise.all([
      lineIds.length ? db.select().from(propScoresTable).where(inArray(propScoresTable.ppLineId, lineIds)) : [],
      allPlayerIds.length ? db.select().from(playersTable).where(inArray(playersTable.id, allPlayerIds)) : [],
      db.select().from(teamsTable),
      lineIds.length
        ? db.select().from(ppLineHistoryTable)
            .where(inArray(ppLineHistoryTable.ppLineId, lineIds))
            .orderBy(desc(ppLineHistoryTable.capturedAt))
        : [],
    ]);

    const playerMap = Object.fromEntries(allPlayers.map(p => [p.id, p]));
    const teamMap = Object.fromEntries(allTeams.map(t => [t.id, t]));
    const scoreByLineId = Object.fromEntries(lineScores.map(s => [s.ppLineId, s]));

    // Top PLAY props by final score
    const topPlayProps = activeLines
      .map(line => {
        const score = scoreByLineId[line.id];
        if (!score || score.actionTag !== "PLAY") return null;
        const player = playerMap[line.playerId];
        return {
          ppLineId: line.id,
          playerName: player?.fullName ?? "Unknown",
          sport: player?.sport ?? "unknown",
          statType: line.statType,
          lineValue: Number(line.lineValue),
          lineType: line.lineType,
          finalScore: Number(score.finalScore),
          edgeScore: Number(score.edgeScore),
          actionTag: score.actionTag,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.finalScore ?? 0) - (a?.finalScore ?? 0))
      .slice(0, 8);

    // Biggest line movements
    const histByLine: Record<number, typeof allHistory> = {};
    for (const h of allHistory) {
      if (!histByLine[h.ppLineId]) histByLine[h.ppLineId] = [];
      histByLine[h.ppLineId].push(h);
    }

    const lineMovements = activeLines
      .map(line => {
        const history = histByLine[line.id] ?? [];
        if (history.length < 2) return null;
        const newest = history[0];
        const prev = history[1];
        const delta = Number(newest.lineValue) - Number(prev.lineValue);
        if (Math.abs(delta) < 0.1) return null;
        const player = playerMap[line.playerId];
        return {
          ppLineId: line.id,
          playerName: player?.fullName ?? "Unknown",
          statType: line.statType,
          prevValue: Number(prev.lineValue),
          currentValue: Number(newest.lineValue),
          delta,
          updatedAt: newest.capturedAt.toISOString(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b?.delta ?? 0) - Math.abs(a?.delta ?? 0))
      .slice(0, 6);

    // Enrich games with team info
    const enrichedGames = todaysGames.map(g => ({
      ...g,
      startTime: g.startTime.toISOString(),
      homeTeamAbbr: teamMap[g.homeTeamId]?.abbreviation ?? null,
      awayTeamAbbr: teamMap[g.awayTeamId]?.abbreviation ?? null,
      homeTeamName: teamMap[g.homeTeamId]?.name ?? null,
      awayTeamName: teamMap[g.awayTeamId]?.name ?? null,
    }));

    // Enrich injuries
    const enrichedInjuries = recentInjuries.map(i => ({
      ...i,
      reportedAt: i.reportedAt.toISOString(),
      playerName: playerMap[i.playerId]?.fullName ?? null,
      playerTeam: playerMap[i.playerId]?.teamId
        ? teamMap[playerMap[i.playerId].teamId as number]?.abbreviation ?? null
        : null,
    }));

    const activeScoredLines = activeLines.map(l => scoreByLineId[l.id]).filter(Boolean);
    const avgEdgeScore = activeScoredLines.length
      ? activeScoredLines.reduce((sum, s) => sum + Number(s!.edgeScore), 0) / activeScoredLines.length
      : null;

    const dataFreshness = {
      ppLines: activeLines.length > 0 ? Math.min(...activeLines.map(l => l.updatedAt.getTime())) : null,
      injuries: recentInjuries.length > 0 ? recentInjuries[0].reportedAt.getTime() : null,
    };

    res.json({
      todaysGames: enrichedGames,
      topInjuries: enrichedInjuries,
      biggestLineMovements: lineMovements,
      topPlayProps,
      watchlistCount: Number(watchlistCountResult[0]?.count ?? 0),
      activePropsCount: activeLines.length,
      pendingEntriesCount: Number(pendingEntriesResult[0]?.count ?? 0),
      averageEdgeScore: avgEdgeScore,
      unreadAlertsCount: Number(unreadAlertsResult[0]?.count ?? 0),
      dataFreshness,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
