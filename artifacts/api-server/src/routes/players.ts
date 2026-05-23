import { Router } from "express";
import { db } from "@workspace/db";
import { playersTable } from "@workspace/db/schema";
import { eq, ilike, and, type SQL } from "drizzle-orm";

const router = Router();

router.get("/players", async (req, res) => {
  try {
    const { sport, teamId, search } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (sport) conditions.push(eq(playersTable.sport, sport));
    if (teamId) conditions.push(eq(playersTable.teamId, Number(teamId)));
    if (search) conditions.push(ilike(playersTable.fullName, `%${search}%`));

    const players = conditions.length
      ? await db.select().from(playersTable).where(and(...conditions))
      : await db.select().from(playersTable);
    res.json(players);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/players", async (req, res) => {
  try {
    const [player] = await db.insert(playersTable).values(req.body).returning();
    res.status(201).json(player);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/players/:id", async (req, res) => {
  try {
    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, Number(req.params.id)));
    if (!player) return void res.status(404).json({ error: "Player not found" });
    res.json(player);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/players/:id", async (req, res) => {
  try {
    const [player] = await db.update(playersTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(playersTable.id, Number(req.params.id)))
      .returning();
    if (!player) return void res.status(404).json({ error: "Player not found" });
    res.json(player);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
