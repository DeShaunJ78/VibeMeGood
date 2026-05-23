import { Router } from "express";
import { db } from "@workspace/db";
import { propScoresTable } from "@workspace/db/schema";
import { eq, and, gte, type SQL } from "drizzle-orm";

const router = Router();

router.get("/prop-scores", async (req, res) => {
  try {
    const { playerId, gameId, statType, actionTag, minFinalScore } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (playerId) conditions.push(eq(propScoresTable.playerId, Number(playerId)));
    if (gameId) conditions.push(eq(propScoresTable.gameId, Number(gameId)));
    if (statType) conditions.push(eq(propScoresTable.statType, statType));
    if (actionTag) conditions.push(eq(propScoresTable.actionTag, actionTag));

    const scores = conditions.length
      ? await db.select().from(propScoresTable).where(and(...conditions))
      : await db.select().from(propScoresTable);

    const filtered = minFinalScore
      ? scores.filter(s => Number(s.finalScore) >= Number(minFinalScore))
      : scores;

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/prop-scores/:id", async (req, res) => {
  try {
    const [score] = await db.select().from(propScoresTable).where(eq(propScoresTable.id, Number(req.params.id)));
    if (!score) return void res.status(404).json({ error: "Prop score not found" });
    res.json(score);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
