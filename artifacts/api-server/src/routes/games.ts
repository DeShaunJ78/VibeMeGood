import { Router } from "express";
import { db } from "@workspace/db";
import { gamesTable, teamsTable } from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, type SQL } from "drizzle-orm";

const router = Router();

router.get("/games", async (req, res) => {
  try {
    const { sport, date, status } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (sport) conditions.push(eq(gamesTable.sport, sport));
    if (status) conditions.push(eq(gamesTable.status, status));
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      conditions.push(gte(gamesTable.startTime, start));
      conditions.push(lte(gamesTable.startTime, end));
    }

    const games = conditions.length
      ? await db.select().from(gamesTable).where(and(...conditions))
      : await db.select().from(gamesTable);

    const teamIds = [...new Set([...games.map(g => g.homeTeamId), ...games.map(g => g.awayTeamId)])];
    const teams = teamIds.length ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds)) : [];
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t]));

    const enriched = games.map(g => ({
      ...g,
      homeTeamAbbr: teamMap[g.homeTeamId]?.abbreviation ?? null,
      awayTeamAbbr: teamMap[g.awayTeamId]?.abbreviation ?? null,
      homeTeamName: teamMap[g.homeTeamId]?.name ?? null,
      awayTeamName: teamMap[g.awayTeamId]?.name ?? null,
    }));

    res.json(enriched);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/games", async (req, res) => {
  try {
    const [game] = await db.insert(gamesTable).values(req.body).returning();
    res.status(201).json(game);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/games/:id", async (req, res): Promise<void> => {
  try {
    const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, Number(req.params.id)));
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    res.json(game);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
