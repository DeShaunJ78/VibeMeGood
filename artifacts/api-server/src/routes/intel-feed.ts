import { Router } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, playersTable, ourProjectionsTable, propScoresTable,
  playerStreaksTable, lineMoveEventsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, isNotNull, sql } from "drizzle-orm";

const router = Router();

router.get("/intel-feed", async (req, res): Promise<void> => {
  try {
    const [streakRows, lineMoveRows, playRows, fadeRows] = await Promise.all([
      db.select({
        playerName: playersTable.fullName,
        sport:       playersTable.sport,
        statType:    playerStreaksTable.statType,
        streakType:  playerStreaksTable.streakType,
        streakLength: sql<number>`abs(${playerStreaksTable.currentStreak})`,
      })
        .from(playerStreaksTable)
        .innerJoin(playersTable, eq(playerStreaksTable.playerId, playersTable.id))
        .where(sql`abs(${playerStreaksTable.currentStreak}) >= 3`)
        .orderBy(desc(sql<number>`abs(${playerStreaksTable.currentStreak})`))
        .limit(6),

      db.select({
        prevLine:        lineMoveEventsTable.prevLine,
        newLine:         lineMoveEventsTable.newLine,
        moveSize:        lineMoveEventsTable.moveSize,
        moveDirection:   lineMoveEventsTable.moveDirection,
        sharpSignal:     lineMoveEventsTable.sharpSignal,
        sharpExplanation: lineMoveEventsTable.sharpExplanation,
        capturedAt:      lineMoveEventsTable.capturedAt,
        statType:        ppLinesTable.statType,
        playerName:      playersTable.fullName,
        sport:           playersTable.sport,
      })
        .from(lineMoveEventsTable)
        .innerJoin(ppLinesTable, eq(lineMoveEventsTable.ppLineId, ppLinesTable.id))
        .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
        .where(and(
          isNotNull(lineMoveEventsTable.ppLineId),
          isNotNull(lineMoveEventsTable.capturedAt),
          gte(lineMoveEventsTable.capturedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ))
        .orderBy(desc(lineMoveEventsTable.capturedAt))
        .limit(6),

      db.select({
        playerName:      playersTable.fullName,
        sport:           playersTable.sport,
        statType:        ppLinesTable.statType,
        lineValue:       ppLinesTable.lineValue,
        lineType:        ppLinesTable.lineType,
        pOver:           ourProjectionsTable.pOver,
        edgeScore:       propScoresTable.edgeScore,
        overallScore:    propScoresTable.finalScore,
        recommendedSide: propScoresTable.recommendedSide,
      })
        .from(propScoresTable)
        .innerJoin(ppLinesTable, eq(propScoresTable.ppLineId, ppLinesTable.id))
        .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
        .leftJoin(ourProjectionsTable, and(
          eq(ourProjectionsTable.playerId, ppLinesTable.playerId),
          eq(ourProjectionsTable.statType, ppLinesTable.statType),
        ))
        .where(and(eq(ppLinesTable.isActive, true), eq(propScoresTable.actionTag, "PLAY")))
        .orderBy(desc(propScoresTable.finalScore))
        .limit(5),

      db.select({
        playerName:      playersTable.fullName,
        sport:           playersTable.sport,
        statType:        ppLinesTable.statType,
        lineValue:       ppLinesTable.lineValue,
        lineType:        ppLinesTable.lineType,
        pOver:           ourProjectionsTable.pOver,
        edgeScore:       propScoresTable.edgeScore,
        overallScore:    propScoresTable.finalScore,
        recommendedSide: propScoresTable.recommendedSide,
      })
        .from(propScoresTable)
        .innerJoin(ppLinesTable, eq(propScoresTable.ppLineId, ppLinesTable.id))
        .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
        .leftJoin(ourProjectionsTable, and(
          eq(ourProjectionsTable.playerId, ppLinesTable.playerId),
          eq(ourProjectionsTable.statType, ppLinesTable.statType),
        ))
        .where(and(eq(ppLinesTable.isActive, true), eq(propScoresTable.actionTag, "NO-PLAY")))
        .orderBy(desc(propScoresTable.edgeScore))
        .limit(3),
    ]);

    res.json({
      hotStreaks: streakRows,
      lineMoves:  lineMoveRows,
      topPlays:   playRows,
      topFades:   fadeRows,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
