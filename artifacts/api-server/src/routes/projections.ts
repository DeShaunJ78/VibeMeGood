import { Router } from "express";
import { db } from "@workspace/db";
import { projectionsTable } from "@workspace/db/schema";
import { eq, and, type SQL } from "drizzle-orm";

const router = Router();

router.get("/projections", async (req, res) => {
  try {
    const { playerId, gameId, statType, source } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (playerId) conditions.push(eq(projectionsTable.playerId, Number(playerId)));
    if (gameId) conditions.push(eq(projectionsTable.gameId, Number(gameId)));
    if (statType) conditions.push(eq(projectionsTable.statType, statType));
    if (source) conditions.push(eq(projectionsTable.projectionSource, source));

    const projs = conditions.length
      ? await db.select().from(projectionsTable).where(and(...conditions))
      : await db.select().from(projectionsTable);
    res.json(projs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projections", async (req, res) => {
  try {
    const data = { ...req.body, generatedAt: req.body.generatedAt || new Date() };
    const [proj] = await db.insert(projectionsTable).values(data).returning();
    res.status(201).json(proj);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projections/:id", async (req, res) => {
  try {
    const [proj] = await db.select().from(projectionsTable).where(eq(projectionsTable.id, Number(req.params.id)));
    if (!proj) return void res.status(404).json({ error: "Projection not found" });
    res.json(proj);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
