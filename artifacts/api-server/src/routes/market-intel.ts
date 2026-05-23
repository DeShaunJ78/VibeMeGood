import { Router } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, externalLinesTable, propScoresTable, playersTable,
  ourProjectionsTable, playerStreaksTable, lineMoveEventsTable, syncRunsTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/market-intel", async (req, res) => {
  try {
    const rows = await db
      .select({
        line: ppLinesTable,
        player: playersTable,
        score: propScoresTable,
        proj: ourProjectionsTable,
        streak: playerStreaksTable,
      })
      .from(ppLinesTable)
      .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
      .leftJoin(propScoresTable, eq(propScoresTable.ppLineId, ppLinesTable.id))
      .leftJoin(
        ourProjectionsTable,
        and(
          eq(ourProjectionsTable.playerId, ppLinesTable.playerId),
          eq(ourProjectionsTable.statType, ppLinesTable.statType),
        ),
      )
      .leftJoin(
        playerStreaksTable,
        and(
          eq(playerStreaksTable.playerId, ppLinesTable.playerId),
          eq(playerStreaksTable.statType, ppLinesTable.statType),
        ),
      )
      .where(eq(ppLinesTable.isActive, true));

    // Get last odds sync run to determine marketDataStatus
    const [lastOddsRun] = await db
      .select()
      .from(syncRunsTable)
      .where(eq(syncRunsTable.jobName, "external-odds"))
      .orderBy(desc(syncRunsTable.finishedAt))
      .limit(1);

    const result = await Promise.all(
      rows.map(async row => {
        const extLines = await db
          .select()
          .from(externalLinesTable)
          .where(eq(externalLinesTable.ppLineId, row.line.id));

        const bookLines: Record<string, number> = {};
        for (const l of extLines) {
          const val = l.lineValue || l.overLine;
          if (val) bookLines[l.bookName] = parseFloat(val.toString());
        }

        const vals = Object.values(bookLines);
        const marketAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        const ppLine = parseFloat(row.line.lineValue.toString());
        const trueEdge = marketAvg ? (-(ppLine - marketAvg) / marketAvg) * 100 : null;

        // marketDataStatus — never show edge score based on guesswork
        let marketDataStatus: "available" | "partial" | "unavailable" | "not_synced";
        if (vals.length >= 2) {
          const ageMins = lastOddsRun?.finishedAt
            ? (Date.now() - lastOddsRun.finishedAt.getTime()) / 60000
            : Infinity;
          marketDataStatus = ageMins <= 30 ? "available" : ageMins <= 60 ? "partial" : "unavailable";
        } else if (vals.length === 1) {
          marketDataStatus = "partial";
        } else if (lastOddsRun) {
          marketDataStatus = "unavailable";
        } else {
          marketDataStatus = "not_synced";
        }

        const recentMoves = await db
          .select()
          .from(lineMoveEventsTable)
          .where(eq(lineMoveEventsTable.ppLineId, row.line.id))
          .orderBy(desc(lineMoveEventsTable.capturedAt))
          .limit(5);

        return {
          ppLineId: row.line.id,
          playerId: row.player.id,
          playerName: row.player.fullName,
          teamId: row.player.teamId,
          sport: row.player.sport,
          statType: row.line.statType,
          lineValue: ppLine,
          lineType: row.line.lineType,
          marketAvg: marketAvg ? Math.round(marketAvg * 100) / 100 : null,
          trueEdge: trueEdge ? Math.round(trueEdge * 10) / 10 : null,
          bookLines,
          marketDataStatus,
          // Only show edge score when market data is actually available
          edgeScore: marketDataStatus !== "not_synced" && row.score
            ? parseFloat(row.score.finalScore?.toString() || "0")
            : null,
          actionTag: marketDataStatus !== "not_synced" ? (row.score?.actionTag || null) : null,
          ourProjection: row.proj
            ? {
                value: parseFloat(row.proj.projectedValue.toString()),
                confidence: row.proj.confidence,
                gamesUsed: row.proj.gamesUsed,
              }
            : null,
          streak: row.streak
            ? {
                count: Math.abs(row.streak.currentStreak || 0),
                type: row.streak.streakType,
              }
            : null,
          recentMoves: recentMoves.map(m => ({
            book: m.bookName,
            from: m.prevLine,
            to: m.newLine,
            direction: m.moveDirection,
            at: m.capturedAt,
          })),
        };
      }),
    );

    const { sport, actionTag, lineType, minEdgeScore } = req.query as Record<string, string>;
    let filtered = result;
    if (sport) filtered = filtered.filter(r => r.sport === sport);
    if (actionTag) filtered = filtered.filter(r => r.actionTag === actionTag);
    if (lineType) filtered = filtered.filter(r => r.lineType === lineType);
    if (minEdgeScore) {
      filtered = filtered.filter(
        r => r.edgeScore !== null && r.edgeScore >= Number(minEdgeScore),
      );
    }

    res.json(filtered.sort((a, b) => (b.edgeScore ?? 0) - (a.edgeScore ?? 0)));
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
