import { Router } from "express";
import { db } from "@workspace/db";
import { watchlistItemsTable, playersTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

async function enrichWatchlist(items: typeof watchlistItemsTable.$inferSelect[]) {
  if (items.length === 0) return [];
  const playerIds = [...new Set(items.map(w => w.playerId))];
  const players = await db.select({ id: playersTable.id, fullName: playersTable.fullName })
    .from(playersTable).where(inArray(playersTable.id, playerIds));
  const playerMap = Object.fromEntries(players.map(p => [p.id, p.fullName]));
  return items.map(w => ({ ...w, playerName: playerMap[w.playerId] ?? null }));
}

router.get("/watchlist", async (req, res) => {
  try {
    const { playerId } = req.query as Record<string, string>;
    const items = playerId
      ? await db.select().from(watchlistItemsTable).where(eq(watchlistItemsTable.playerId, Number(playerId)))
      : await db.select().from(watchlistItemsTable);
    res.json(await enrichWatchlist(items));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/watchlist", async (req, res) => {
  try {
    const [item] = await db.insert(watchlistItemsTable).values(req.body).returning();
    const enriched = await enrichWatchlist([item]);
    res.status(201).json(enriched[0]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/watchlist/:id", async (req, res): Promise<void> => {
  try {
    const [item] = await db.update(watchlistItemsTable)
      .set(req.body)
      .where(eq(watchlistItemsTable.id, Number(req.params.id)))
      .returning();
    if (!item) {
      res.status(404).json({ error: "Watchlist item not found" });
      return;
    }
    const enriched = await enrichWatchlist([item]);
    res.json(enriched[0]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/watchlist/:id", async (req, res) => {
  try {
    await db.delete(watchlistItemsTable).where(eq(watchlistItemsTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
