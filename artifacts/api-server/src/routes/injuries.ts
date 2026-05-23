import { Router } from "express";
import { db } from "@workspace/db";
import { injuriesTable, playersTable, teamsTable } from "@workspace/db/schema";
import { eq, and, gte, inArray, type SQL } from "drizzle-orm";

const router = Router();

router.get("/injuries", async (req, res): Promise<void> => {
  try {
    const { sport, playerId, gameId, since } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (sport) conditions.push(eq(injuriesTable.sport, sport));
    if (playerId) conditions.push(eq(injuriesTable.playerId, Number(playerId)));
    if (gameId) conditions.push(eq(injuriesTable.gameId, Number(gameId)));
    if (since) conditions.push(gte(injuriesTable.reportedAt, new Date(since)));

    const injuries = conditions.length
      ? await db.select().from(injuriesTable).where(and(...conditions))
      : await db.select().from(injuriesTable);

    if (injuries.length === 0) {
      res.json([]);
      return;
    }

    const playerIds = [...new Set(injuries.map(i => i.playerId))];
    const players = await db.select({ id: playersTable.id, fullName: playersTable.fullName, teamId: playersTable.teamId })
      .from(playersTable).where(inArray(playersTable.id, playerIds));

    const teamIds = [...new Set(players.filter(p => p.teamId).map(p => p.teamId as number))];
    const teams = teamIds.length
      ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
      : [];
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t.abbreviation]));
    const playerMap = Object.fromEntries(players.map(p => [p.id, p]));

    const enriched = injuries.map(inj => ({
      ...inj,
      playerName: playerMap[inj.playerId]?.fullName ?? null,
      playerTeam: playerMap[inj.playerId]?.teamId
        ? teamMap[playerMap[inj.playerId].teamId as number] ?? null
        : null,
    }));

    res.json(enriched);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/injuries", async (req, res) => {
  try {
    const [inj] = await db.insert(injuriesTable).values(req.body).returning();
    res.status(201).json(inj);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
