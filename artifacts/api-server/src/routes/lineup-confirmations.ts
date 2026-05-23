import { Router } from "express";
import { db } from "@workspace/db";
import { lineupConfirmationsTable, playersTable } from "@workspace/db/schema";
import { eq, and, gte, inArray, type SQL } from "drizzle-orm";

const router = Router();

router.get("/lineup-confirmations", async (req, res): Promise<void> => {
  try {
    const { playerId, gameId, since } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (playerId) conditions.push(eq(lineupConfirmationsTable.playerId, Number(playerId)));
    if (gameId) conditions.push(eq(lineupConfirmationsTable.gameId, Number(gameId)));
    if (since) conditions.push(gte(lineupConfirmationsTable.confirmedAt, new Date(since)));

    const confs = conditions.length
      ? await db.select().from(lineupConfirmationsTable).where(and(...conditions))
      : await db.select().from(lineupConfirmationsTable);

    if (confs.length === 0) {
      res.json([]);
      return;
    }

    const playerIds = [...new Set(confs.map(c => c.playerId))];
    const players = await db.select({ id: playersTable.id, fullName: playersTable.fullName })
      .from(playersTable).where(inArray(playersTable.id, playerIds));
    const playerMap = Object.fromEntries(players.map(p => [p.id, p.fullName]));

    res.json(confs.map(c => ({ ...c, playerName: playerMap[c.playerId] ?? null })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/lineup-confirmations", async (req, res) => {
  try {
    const [conf] = await db.insert(lineupConfirmationsTable).values(req.body).returning();
    res.status(201).json(conf);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
