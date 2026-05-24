import { Router } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, externalLinesTable, propScoresTable, playersTable,
  ourProjectionsTable, playerStreaksTable, lineMoveEventsTable, syncRunsTable,
  varianceScoresTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, desc, gte } from "drizzle-orm";
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
      .where(and(
        eq(ppLinesTable.isActive, true),
        or(
          isNull(ppLinesTable.lastSyncedAt),
          gte(ppLinesTable.lastSyncedAt, new Date(Date.now() - 12 * 60 * 60 * 1000)),
        ),
      ));

    // Last odds sync for marketDataStatus
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
          .where(
            or(
              eq(externalLinesTable.ppLineId, row.line.id),
              and(
                isNull(externalLinesTable.ppLineId),
                eq(externalLinesTable.playerId, row.line.playerId),
                eq(externalLinesTable.statType, row.line.statType),
              ),
            ),
          );

        const bookLines: Record<string, number> = {};
        for (const l of extLines) {
          const val = l.lineValue || l.overLine;
          if (val) bookLines[l.bookName] = parseFloat(val.toString());
        }

        const vals = Object.values(bookLines);
        const marketAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        const ppLine = parseFloat(row.line.lineValue.toString());
        const trueEdge = marketAvg ? (-(ppLine - marketAvg) / marketAvg) * 100 : null;

        // marketDataStatus — never show edge scores based on guesswork
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

        const [varScore] = await db.select({
          volatilityRating: varianceScoresTable.volatilityRating,
          blowoutRisk: varianceScoresTable.blowoutRisk,
          fatigueScore: varianceScoresTable.fatigueScore,
          usageScore: varianceScoresTable.usageScore,
          matchupScore: varianceScoresTable.matchupScore,
          environmentScore: varianceScoresTable.environmentScore,
          warnings: varianceScoresTable.warnings,
          evModifier: varianceScoresTable.evModifier,
          whyItMoves: varianceScoresTable.whyItMoves,
        }).from(varianceScoresTable).where(eq(varianceScoresTable.ppLineId, row.line.id));

        // Projection distribution — full output
        const proj = row.proj;
        const noPlayReason = proj?.noPlayReason ?? null;
        const pOver = proj?.pOver ? parseFloat(proj.pOver.toString()) : null;
        const dqScore = proj?.dataQualityScore ?? null;

        // Projection staleness check
        const isStale = proj?.expiresAt ? new Date() > proj.expiresAt : false;
        const effectiveNoPlay = noPlayReason ?? (isStale ? "stale_projection" : null);

        // Projection source label — show what powered this
        const sourceLabel = isStale
          ? `${proj?.sourceLabel ?? "prior_only"} (stale)`
          : (proj?.sourceLabel ?? null);

        // Reasoning blob from prop score
        const scoreReasoning = (row.score?.reasoning as Record<string, unknown> | null) ?? null;

        return {
          ppLineId: row.line.id,
          playerId: row.player.id,
          playerName: row.player.fullName,
          imageUrl: row.player.imageUrl ?? null,
          teamId: row.player.teamId,
          sport: row.player.sport,
          statType: row.line.statType,
          lineValue: ppLine,
          lineType: row.line.lineType,

          // Market
          marketAvg: marketAvg ? Math.round(marketAvg * 100) / 100 : null,
          trueEdge: trueEdge ? Math.round(trueEdge * 10) / 10 : null,
          bookLines,
          marketDataStatus,
          bookCount: vals.length,

          // Scores — only show when data available
          edgeScore: marketDataStatus !== "not_synced" && row.score
            ? parseFloat(row.score.finalScore?.toString() || "0")
            : null,
          actionTag: row.score?.actionTag ?? null,

          // Projection distribution
          ourProjection: proj ? {
            value: parseFloat(proj.projectedValue.toString()),
            stdDev: proj.stdDev ? parseFloat(proj.stdDev.toString()) : null,
            pOver,
            percentileAtLine: proj.percentileAtLine ? parseFloat(proj.percentileAtLine.toString()) : null,
            noPlayReason: effectiveNoPlay,
            dataQualityScore: dqScore,
            sourceLabel,
            confidence: proj.confidence,
            gamesUsed: proj.gamesUsed,
            shrinkageFactor: proj.shrinkageFactor ? parseFloat(proj.shrinkageFactor.toString()) : null,
            isStale,
          } : null,

          // Streak
          streak: row.streak ? {
            count: Math.abs(row.streak.currentStreak ?? 0),
            type: row.streak.streakType,
          } : null,

          // Line movement
          recentMoves: recentMoves.map(m => ({
            book: m.bookName,
            from: m.prevLine,
            to: m.newLine,
            direction: m.moveDirection,
            at: m.capturedAt,
          })),

          // Full reasoning for explainability
          scoring: scoreReasoning,

          // Variance Intelligence (null when varianceIntelEnabled=false or not computed yet)
          variance: varScore ? {
            volatilityRating: varScore.volatilityRating,
            blowoutRisk: varScore.blowoutRisk,
            fatigueScore: varScore.fatigueScore,
            usageScore: varScore.usageScore,
            matchupScore: varScore.matchupScore,
            environmentScore: varScore.environmentScore,
            warnings: varScore.warnings as string[] | null,
            evModifier: varScore.evModifier,
            whyItMoves: varScore.whyItMoves,
          } : null,
        };
      }),
    );

    // Filters
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

    // Sort: NO-PLAY to bottom, then by edge score desc
    filtered.sort((a, b) => {
      const aNoPlay = a.actionTag === "NO-PLAY" ? 1 : 0;
      const bNoPlay = b.actionTag === "NO-PLAY" ? 1 : 0;
      if (aNoPlay !== bNoPlay) return aNoPlay - bNoPlay;
      return (b.edgeScore ?? 0) - (a.edgeScore ?? 0);
    });

    res.json(filtered);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
