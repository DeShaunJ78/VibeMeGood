import { Router } from "express";
import { db } from "@workspace/db";
import { teamsTable } from "@workspace/db/schema";
import { eq, and, type SQL } from "drizzle-orm";

const router = Router();

router.get("/teams", async (req, res) => {
  try {
    const { sport } = req.query as Record<string, string>;
    const teams = sport
      ? await db.select().from(teamsTable).where(eq(teamsTable.sport, sport))
      : await db.select().from(teamsTable);
    res.json(teams);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/teams", async (req, res) => {
  try {
    const [team] = await db.insert(teamsTable).values(req.body).returning();
    res.status(201).json(team);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/teams/:id", async (req, res) => {
  try {
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, Number(req.params.id)));
    if (!team) return void res.status(404).json({ error: "Team not found" });
    res.json(team);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
