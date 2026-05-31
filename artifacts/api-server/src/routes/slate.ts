import { Router } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, propScoresTable, playersTable,
  teamsTable, gamesTable, watchlistItemsTable, externalLinesTable,
  ppLineHistoryTable, injuriesTable, lineupConfirmationsTable,
  ourProjectionsTable, playerGameLogsTable,
} from "@workspace/db/schema";
import { eq, and, inArray, desc, gte, isNull, or } from "drizzle-orm";

const router = Router();

router.get("/slate", async (req, res) => {
  try {
    const { sport, statType, actionTag, lineType, teamId, gameId, minEdgeScore, maxRiskScore, watchlistOnly } =
      req.query as Record<string, string>;

    const cutoff12h = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const lineConditions = [
      and(
        eq(ppLinesTable.isActive, true),
        or(isNull(ppLinesTable.lastSyncedAt), gte(ppLinesTable.lastSyncedAt, cutoff12h)),
      ),
    ];
    if (statType) lineConditions.push(eq(ppLinesTable.statType, statType));
    if (lineType) lineConditions.push(eq(ppLinesTable.lineType, lineType));
    if (gameId) lineConditions.push(eq(ppLinesTable.gameId, Number(gameId)));

    const lines = await db.select().from(ppLinesTable).where(and(...lineConditions));
    if (lines.length === 0) return void res.json([]);

    const lineIds = lines.map(l => l.id);
    const playerIds = [...new Set(lines.map(l => l.playerId))];
    const gameIds = [...new Set(lines.filter(l => l.gameId).map(l => l.gameId as number))];

    const [players, scores, ourProjections, watchlistItems, games] = await Promise.all([
      db.select().from(playersTable).where(inArray(playersTable.id, playerIds)),
      db.select().from(propScoresTable).where(inArray(propScoresTable.ppLineId, lineIds)),
      db.select().from(ourProjectionsTable).where(inArray(ourProjectionsTable.playerId, playerIds)),
      db.select().from(watchlistItemsTable).where(inArray(watchlistItemsTable.playerId, playerIds)),
      gameIds.length ? db.select().from(gamesTable).where(inArray(gamesTable.id, gameIds)) : [],
    ]);

    const teamIds2 = [...new Set(players.filter(p => p.teamId).map(p => p.teamId as number))];
    const gameTeamIds = [...new Set([...games.map(g => g.homeTeamId), ...games.map(g => g.awayTeamId)])];
    const allTeamIds = [...new Set([...teamIds2, ...gameTeamIds])];
    const teams = allTeamIds.length
      ? await db.select().from(teamsTable).where(inArray(teamsTable.id, allTeamIds))
      : [];

    const playerMap = Object.fromEntries(players.map(p => [p.id, p]));
    const scoreMap = Object.fromEntries(scores.map(s => [s.ppLineId, s]));
    const projMap: Record<string, typeof ourProjections[0]> = {};
    for (const p of ourProjections) {
      projMap[`${p.playerId}:${p.statType}`] = p;
    }
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t]));
    const gameMap = Object.fromEntries(games.map(g => [g.id, g]));
    const watchlistSet = new Set(watchlistItems.map(w => `${w.playerId}:${w.statType}`));

    const rows = lines.map(line => {
      const player = playerMap[line.playerId];
      const score = scoreMap[line.id];
      const proj = projMap[`${line.playerId}:${line.statType}`];
      const game = line.gameId ? gameMap[line.gameId] : null;
      const playerTeam = player?.teamId ? teamMap[player.teamId] : null;
      let opponentAbbr: string | null = null;
      if (game && player?.teamId) {
        const oppTeamId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
        opponentAbbr = teamMap[oppTeamId]?.abbreviation ?? null;
      }

      return {
        ppLineId: line.id,
        playerId: line.playerId,
        playerName: player?.fullName ?? "Unknown",
        position: player?.position ?? null,
        imageUrl: player?.imageUrl ?? null,
        teamAbbr: playerTeam?.abbreviation ?? null,
        opponentAbbr,
        sport: player?.sport ?? "unknown",
        startTime: game?.startTime?.toISOString() ?? null,
        statType: line.statType,
        lineValue: Number(line.lineValue),
        lineType: line.lineType,
        directionalityType: line.directionalityType,
        pickCategory: line.pickCategory,
        teamPickType: line.teamPickType ?? null,
        teamId: line.teamId ?? null,
        yourProjection: proj ? Number(proj.projectedValue) : null,
        projectionGap: proj ? Number(proj.projectedValue) - Number(line.lineValue) : null,
        pOver: proj?.pOver ? Number(proj.pOver) : null,
        edgeScore: score ? Number(score.edgeScore) : null,
        stabilityScore: score ? Number(score.stabilityScore) : null,
        marketSupportScore: score ? Number(score.marketSupportScore) : null,
        riskScore: score ? Number(score.riskScore) : null,
        finalScore: score ? Number(score.finalScore) : null,
        actionTag: score?.actionTag ?? null,
        isWatched: watchlistSet.has(`${line.playerId}:${line.statType}`),
        updatedAt: line.updatedAt.toISOString(),
      };
    });

    let filtered = rows;
    if (sport) {
      const sportsToMatch =
        sport === "NFL"  ? ["NFL", "NFLSZN"] :
        sport === "NBA"  ? ["NBA", "NBA1Q", "NBA1H", "NBA1P"] :
        sport === "MLB"  ? ["MLB", "MLBLIVE"] :
        sport === "NHL"  ? ["NHL", "NHL1P"] :
        sport === "WNBA" ? ["WNBA", "WNBA1H"] :
        [sport];
      filtered = filtered.filter(r => sportsToMatch.includes(r.sport));
    }
    if (actionTag) filtered = filtered.filter(r => r.actionTag === actionTag);
    if (minEdgeScore) filtered = filtered.filter(r => r.edgeScore !== null && r.edgeScore >= Number(minEdgeScore));
    if (maxRiskScore) filtered = filtered.filter(r => r.riskScore !== null && r.riskScore <= Number(maxRiskScore));
    if (watchlistOnly === "true") filtered = filtered.filter(r => r.isWatched);
    if (teamId) {
      const tidNum = Number(teamId);
      filtered = filtered.filter(r => playerMap[r.playerId]?.teamId === tidNum);
    }

    res.json(filtered.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0)));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/slate/:ppLineId", async (req, res): Promise<void> => {
  try {
    const lineId = Number(req.params.ppLineId);
    const [line] = await db.select().from(ppLinesTable).where(eq(ppLinesTable.id, lineId));
    if (!line) {
      res.status(404).json({ error: "PP Line not found" });
      return;
    }

    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, line.playerId));
    const [score] = await db.select().from(propScoresTable).where(eq(propScoresTable.ppLineId, lineId));

    const [lineHistory, externalLines, injuries, lineupConfs, ourProj, recentGames] = await Promise.all([
      db.select().from(ppLineHistoryTable).where(eq(ppLineHistoryTable.ppLineId, lineId)).orderBy(ppLineHistoryTable.capturedAt),
      db.select().from(externalLinesTable)
        .where(and(eq(externalLinesTable.playerId, line.playerId), eq(externalLinesTable.statType, line.statType))),
      db.select().from(injuriesTable).where(eq(injuriesTable.playerId, line.playerId)),
      line.gameId
        ? db.select().from(lineupConfirmationsTable)
            .where(and(eq(lineupConfirmationsTable.playerId, line.playerId), eq(lineupConfirmationsTable.gameId, line.gameId)))
        : [],
      db.select().from(ourProjectionsTable)
        .where(and(eq(ourProjectionsTable.playerId, line.playerId), eq(ourProjectionsTable.statType, line.statType)))
        .limit(1),
      db.select().from(playerGameLogsTable)
        .where(and(eq(playerGameLogsTable.playerId, line.playerId), eq(playerGameLogsTable.statType, line.statType)))
        .orderBy(desc(playerGameLogsTable.gameDate))
        .limit(10),
    ]);

    const watchlistRows = await db.select().from(watchlistItemsTable)
      .where(and(eq(watchlistItemsTable.playerId, line.playerId), eq(watchlistItemsTable.statType, line.statType)));

    const game = line.gameId
      ? (await db.select().from(gamesTable).where(eq(gamesTable.id, line.gameId)))[0] ?? null
      : null;

    const op = ourProj[0] ?? null;
    const isStale = op?.expiresAt ? new Date() > op.expiresAt : false;

    res.json({
      ppLine: line,
      player,
      game,
      lineHistory,
      projection: null,
      ourProjection: op ? {
        value: parseFloat(op.projectedValue.toString()),
        stdDev: op.stdDev ? parseFloat(op.stdDev.toString()) : null,
        pOver: op.pOver ? parseFloat(op.pOver.toString()) : null,
        percentileAtLine: op.percentileAtLine ? parseFloat(op.percentileAtLine.toString()) : null,
        dataQualityScore: op.dataQualityScore,
        shrinkageFactor: op.shrinkageFactor ? parseFloat(op.shrinkageFactor.toString()) : null,
        noPlayReason: op.noPlayReason ?? null,
        sourceLabel: isStale ? `${op.sourceLabel} (stale)` : op.sourceLabel,
        confidence: op.confidence,
        gamesUsed: op.gamesUsed,
        isStale,
      } : null,
      recentGames: recentGames.map(g => ({
        date: g.gameDate,
        value: parseFloat(g.value.toString()),
      })).reverse(),
      externalLines,
      propScore: score ?? null,
      injuries,
      lineupConfirmation: lineupConfs[0] ?? null,
      isWatched: watchlistRows.length > 0,
      watchlistId: watchlistRows[0]?.id ?? null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
