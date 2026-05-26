import { Router } from "express";
import { db } from "@workspace/db";
import { varianceScoresTable, playersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { computeAllVarianceScores } from "../lib/variance";

const router = Router();

const VARIANCE_SELECT = {
  id:               varianceScoresTable.id,
  ppLineId:         varianceScoresTable.ppLineId,
  playerId:         varianceScoresTable.playerId,
  statType:         varianceScoresTable.statType,
  playerName:       playersTable.fullName,
  sport:            playersTable.sport,
  volatilityRating: varianceScoresTable.volatilityRating,
  blowoutRisk:      varianceScoresTable.blowoutRisk,
  fatigueScore:     varianceScoresTable.fatigueScore,
  usageScore:       varianceScoresTable.usageScore,
  matchupScore:     varianceScoresTable.matchupScore,
  environmentScore: varianceScoresTable.environmentScore,
  warnings:         varianceScoresTable.warnings,
  evModifier:       varianceScoresTable.evModifier,
  whyItMoves:       varianceScoresTable.whyItMoves,
  computedAt:       varianceScoresTable.computedAt,
};

router.get("/variance/fatigue", async (req, res) => {
  try {
    const scores = await db
      .select(VARIANCE_SELECT)
      .from(varianceScoresTable)
      .leftJoin(playersTable, eq(varianceScoresTable.playerId, playersTable.id))
      .orderBy(desc(varianceScoresTable.fatigueScore));
    res.json(scores);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/variance/usage", async (req, res) => {
  try {
    const scores = await db
      .select(VARIANCE_SELECT)
      .from(varianceScoresTable)
      .leftJoin(playersTable, eq(varianceScoresTable.playerId, playersTable.id))
      .orderBy(desc(varianceScoresTable.usageScore));
    res.json(scores);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/variance/blowout", async (req, res) => {
  try {
    const scores = await db
      .select(VARIANCE_SELECT)
      .from(varianceScoresTable)
      .leftJoin(playersTable, eq(varianceScoresTable.playerId, playersTable.id))
      .orderBy(desc(varianceScoresTable.blowoutRisk));
    res.json(scores);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/variance/stability", async (req, res) => {
  try {
    const scores = await db
      .select(VARIANCE_SELECT)
      .from(varianceScoresTable)
      .leftJoin(playersTable, eq(varianceScoresTable.playerId, playersTable.id))
      .orderBy(desc(varianceScoresTable.volatilityRating));
    res.json(scores);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/variance/:ppLineId", async (req, res) => {
  try {
    const lineId = Number(req.params.ppLineId);
    if (isNaN(lineId)) {
      res.status(400).json({ error: "Invalid ppLineId" });
      return;
    }
    const [score] = await db
      .select(VARIANCE_SELECT)
      .from(varianceScoresTable)
      .leftJoin(playersTable, eq(varianceScoresTable.playerId, playersTable.id))
      .where(eq(varianceScoresTable.ppLineId, lineId));
    if (!score) return void res.json(null);
    res.json(score);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/variance", async (req, res) => {
  try {
    const scores = await db
      .select(VARIANCE_SELECT)
      .from(varianceScoresTable)
      .leftJoin(playersTable, eq(varianceScoresTable.playerId, playersTable.id));
    res.json(scores);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/sync/variance", async (req, res) => {
  res.json({ status: "started" });
  try {
    await computeAllVarianceScores();
  } catch (err) {
    req.log.error(err, "Variance sync failed");
  }
});

export default router;
