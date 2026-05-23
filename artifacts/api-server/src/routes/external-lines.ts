import { Router } from "express";
import { db } from "@workspace/db";
import { externalLinesTable } from "@workspace/db/schema";
import { eq, and, type SQL } from "drizzle-orm";

const router = Router();

router.get("/external-lines", async (req, res) => {
  try {
    const { playerId, gameId, statType, bookName } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (playerId) conditions.push(eq(externalLinesTable.playerId, Number(playerId)));
    if (gameId) conditions.push(eq(externalLinesTable.gameId, Number(gameId)));
    if (statType) conditions.push(eq(externalLinesTable.statType, statType));
    if (bookName) conditions.push(eq(externalLinesTable.bookName, bookName));

    const lines = conditions.length
      ? await db.select().from(externalLinesTable).where(and(...conditions))
      : await db.select().from(externalLinesTable);
    res.json(lines);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
