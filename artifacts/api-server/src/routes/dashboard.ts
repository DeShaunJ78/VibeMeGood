import { Router } from "express";
import { db } from "@workspace/db";
import {
  gamesTable, injuriesTable, ppLinesTable, ppLineHistoryTable,
  propScoresTable, watchlistItemsTable, alertsTable, entriesTable,
  playersTable, teamsTable, ourProjectionsTable,
} from "@workspace/db/schema";
import { eq, and, gte, desc, sql, inArray, isNotNull, isNull, or } from "drizzle-orm";

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
        db.select().from(ppLinesTable).where(and(
          eq(ppLinesTable.isActive, true),
          or(
            isNull(ppLinesTable.lastSyncedAt),
            gte(ppLinesTable.lastSyncedAt, new Date(Date.now() - 12 * 60 * 60 * 1000)),
          ),
        )),
        db.select({ count: sql<number>`count(*)` }).from(watchlistItemsTable),
        db.select({ count: sql<number>`count(*)` }).from(alertsTable).where(eq(alertsTable.isRead, false)),
        db.select({ count: sql<number>`count(*)` }).from(entriesTable).where(eq(entriesTable.result, "pending")),
      ]);

    const lineIds = activeLines.map(l => l.id);
    const injuryPlayerIds = recentInjuries.map(i => i.playerId);
    const linePlayerIds = activeLines.map(l => l.playerId);
    const allPlayerIds = [...new Set([...linePlayerIds, ...injuryPlayerIds])];

    const playerLinePlayerIds = activeLines
      .filter(l => l.pickCategory === "player")
      .map(l => l.playerId);

    const [lineScores, allPlayers, allTeams, allHistory, modelProjections] = await Promise.all([
      lineIds.length ? db.select().from(propScoresTable).where(inArray(propScoresTable.ppLineId, lineIds)) : [],
      allPlayerIds.length ? db.select().from(playersTable).where(inArray(playersTable.id, allPlayerIds)) : [],
      db.select().from(teamsTable),
      lineIds.length
        ? db.select().from(ppLineHistoryTable)
            .where(inArray(ppLineHistoryTable.ppLineId, lineIds))
            .orderBy(desc(ppLineHistoryTable.capturedAt))
        : [],
      playerLinePlayerIds.length
        ? db.select({
            playerId: ourProjectionsTable.playerId,
            statType: ourProjectionsTable.statType,
            pOver: ourProjectionsTable.pOver,
            noPlayReason: ourProjectionsTable.noPlayReason,
          })
          .from(ourProjectionsTable)
          .where(and(
            inArray(ourProjectionsTable.playerId, playerLinePlayerIds),
            isNotNull(ourProjectionsTable.pOver),
          ))
        : ([] as Array<{ playerId: number | null; statType: string; pOver: string | null; noPlayReason: string | null }>),
    ]);

    const playerMap = Object.fromEntries(allPlayers.map(p => [p.id, p]));
    const teamMap = Object.fromEntries(allTeams.map(t => [t.id, t]));
    const scoreByLineId = Object.fromEntries(lineScores.map(s => [s.ppLineId, s]));

    // Build game lookup keyed by (homeTeamId, awayTeamId) to find opponent
    const gamesByTeam: Record<number, typeof todaysGames[0]> = {};
    for (const g of todaysGames) {
      gamesByTeam[g.homeTeamId] = g;
      gamesByTeam[g.awayTeamId] = g;
    }

    // Top PLAY props by final score
    const topPlayProps = activeLines
      .map(line => {
        const score = scoreByLineId[line.id];
        if (!score || score.actionTag !== "PLAY") return null;
        const player = playerMap[line.playerId];
        const teamId = player?.teamId ?? null;
        const teamAbbr = teamId ? (teamMap[teamId]?.abbreviation ?? null) : null;
        const game = teamId ? gamesByTeam[teamId] : null;
        const opponentTeamId = game
          ? (game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId)
          : null;
        const opponentAbbr = opponentTeamId ? (teamMap[opponentTeamId]?.abbreviation ?? null) : null;
        return {
          ppLineId: line.id,
          playerName: player?.fullName ?? "Unknown",
          sport: player?.sport ?? "unknown",
          statType: line.statType,
          lineValue: Number(line.lineValue),
          lineType: line.lineType,
          teamAbbr,
          opponentAbbr,
          finalScore: Number(score.finalScore),
          edgeScore: Number(score.edgeScore),
          actionTag: score.actionTag,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.finalScore ?? 0) - (a?.finalScore ?? 0))
      .slice(0, 8);

    // Biggest line movements
    type HistoryRow = (typeof allHistory)[0];
    const histByLine: Record<number, HistoryRow[]> = {};
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

    // Model intelligence KPIs
    const playPropsCount = activeScoredLines.filter(s => s?.actionTag === "PLAY").length;
    const gatedPropsCount = activeScoredLines.filter(s => s?.actionTag === "NO-PLAY").length;
    const projsForAvg = modelProjections.filter(p => !p.noPlayReason && p.pOver !== null);
    const avgModelPOver = projsForAvg.length
      ? projsForAvg.reduce((sum, p) => sum + parseFloat(p.pOver!.toString()), 0) / projsForAvg.length
      : null;
    // Average P(over) on PLAY props only
    const playPropPlayerIds = new Set(
      activeScoredLines.filter(s => s?.actionTag === "PLAY").map(s => s!.playerId),
    );
    const playProjections = modelProjections.filter(
      p => p.playerId !== null && playPropPlayerIds.has(p.playerId),
    );
    const avgPlayPOver = playProjections.length
      ? playProjections.reduce((sum, p) => sum + parseFloat(p.pOver!.toString()), 0) / playProjections.length
      : null;

    // Top picks by model pOver (all qualified, sorted by confidence)
    const projLookup = new Map(
      modelProjections.map(p => [`${p.playerId}:${p.statType}`, p])
    );
    const topProjProps = activeLines
      .filter(l => !l.pickCategory || l.pickCategory === "player")
      .map(line => {
        const proj = projLookup.get(`${line.playerId}:${line.statType}`);
        if (!proj?.pOver) return null;
        const pOverPct = Math.round(parseFloat(proj.pOver.toString()) * 10) / 10;
        const player = playerMap[line.playerId];
        const teamId = player?.teamId ?? null;
        const teamAbbr = teamId ? (teamMap[teamId]?.abbreviation ?? null) : null;
        const game = teamId ? gamesByTeam[teamId] : null;
        const opponentTeamId = game
          ? (game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId)
          : null;
        const opponentAbbr = opponentTeamId ? (teamMap[opponentTeamId]?.abbreviation ?? null) : null;
        const score = scoreByLineId[line.id];
        return {
          ppLineId: line.id,
          playerName: player?.fullName ?? "Unknown",
          sport: player?.sport ?? "unknown",
          statType: line.statType,
          lineValue: Number(line.lineValue),
          lineType: line.lineType,
          teamAbbr,
          opponentAbbr,
          pOver: pOverPct,
          edgeScore: score ? Number(score.edgeScore) : null,
          actionTag: score?.actionTag ?? null,
          isGated: !!proj.noPlayReason,
          noPlayReason: proj.noPlayReason,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.pOver ?? 0) - (a?.pOver ?? 0))
      .slice(0, 6);

    const dataFreshness = {
      ppLines: activeLines.length > 0 ? Math.min(...activeLines.map(l => l.updatedAt.getTime())) : null,
      injuries: recentInjuries.length > 0 ? recentInjuries[0].reportedAt.getTime() : null,
    };

    res.json({
      todaysGames: enrichedGames,
      topInjuries: enrichedInjuries,
      biggestLineMovements: lineMovements,
      topPlayProps,
      topProjProps,
      watchlistCount: Number(watchlistCountResult[0]?.count ?? 0),
      activePropsCount: activeLines.length,
      pendingEntriesCount: Number(pendingEntriesResult[0]?.count ?? 0),
      averageEdgeScore: avgEdgeScore,
      unreadAlertsCount: Number(unreadAlertsResult[0]?.count ?? 0),
      dataFreshness,
      // Model intelligence
      playPropsCount,
      gatedPropsCount,
      avgModelPOver: avgModelPOver ? Math.round(avgModelPOver * 10) / 10 : null,
      avgPlayPOver: avgPlayPOver ? Math.round(avgPlayPOver * 10) / 10 : null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
