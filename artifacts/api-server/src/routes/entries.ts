import { Router } from "express";
import { db } from "@workspace/db";
import { entriesTable, entryPicksTable, playersTable, ppLinesTable, clvRecordsTable } from "@workspace/db/schema";
import { eq, and, gte, inArray, type SQL } from "drizzle-orm";

const router = Router();

router.get("/entries", async (req, res) => {
  try {
    const { result, entryType, since, search } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (result) conditions.push(eq(entriesTable.result, result));
    if (entryType) conditions.push(eq(entriesTable.entryType, entryType));
    if (since) conditions.push(gte(entriesTable.entryDate, since));

    const entries = conditions.length
      ? await db.select().from(entriesTable).where(and(...conditions))
      : await db.select().from(entriesTable);

    const filtered = search
      ? entries.filter(e => e.notes?.toLowerCase().includes(search.toLowerCase()))
      : entries;

    const sorted = filtered.sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());

    // Join picks for all entries
    const entryIds = sorted.map(e => e.id);
    const allPicks = entryIds.length
      ? await db.select().from(entryPicksTable).where(inArray(entryPicksTable.entryId, entryIds))
      : [];
    const allPlayerIds = [...new Set(allPicks.map(p => p.playerId))];
    const allPlayers = allPlayerIds.length
      ? await db.select({ id: playersTable.id, fullName: playersTable.fullName })
          .from(playersTable).where(inArray(playersTable.id, allPlayerIds))
      : [];
    const playerNameMap = Object.fromEntries(allPlayers.map(p => [p.id, p.fullName]));
    const picksByEntry: Record<number, typeof allPicks> = {};
    for (const pick of allPicks) {
      if (!picksByEntry[pick.entryId]) picksByEntry[pick.entryId] = [];
      picksByEntry[pick.entryId].push({ ...pick, playerName: playerNameMap[pick.playerId] ?? null } as any);
    }

    res.json(sorted.map(e => ({ ...e, picks: picksByEntry[e.id] ?? [] })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/entries", async (req, res) => {
  try {
    const [entry] = await db.insert(entriesTable).values(req.body).returning();
    res.status(201).json(entry);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/entries/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, id));
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    const picks = await db.select().from(entryPicksTable).where(eq(entryPicksTable.entryId, id));
    const playerIds = [...new Set(picks.map(p => p.playerId))];
    const players = playerIds.length
      ? await db.select({ id: playersTable.id, fullName: playersTable.fullName })
          .from(playersTable).where(inArray(playersTable.id, playerIds))
      : [];
    const playerMap = Object.fromEntries(players.map(p => [p.id, p.fullName]));
    const enrichedPicks = picks.map(p => ({ ...p, playerName: playerMap[p.playerId] ?? null }));

    res.json({ entry, picks: enrichedPicks });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/entries/:id", async (req, res): Promise<void> => {
  try {
    const [entry] = await db.update(entriesTable)
      .set(req.body)
      .where(eq(entriesTable.id, Number(req.params.id)))
      .returning();
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(entry);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/entries/:id", async (req, res) => {
  try {
    await db.delete(entryPicksTable).where(eq(entryPicksTable.entryId, Number(req.params.id)));
    await db.delete(entriesTable).where(eq(entriesTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/entries/:entryId/picks", async (req, res) => {
  try {
    const picks = await db.select().from(entryPicksTable).where(eq(entryPicksTable.entryId, Number(req.params.entryId)));
    const playerIds = [...new Set(picks.map(p => p.playerId))];
    const players = playerIds.length
      ? await db.select({ id: playersTable.id, fullName: playersTable.fullName })
          .from(playersTable).where(inArray(playersTable.id, playerIds))
      : [];
    const playerMap = Object.fromEntries(players.map(p => [p.id, p.fullName]));
    res.json(picks.map(p => ({ ...p, playerName: playerMap[p.playerId] ?? null })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/entries/:entryId/picks", async (req, res) => {
  try {
    const [pick] = await db.insert(entryPicksTable)
      .values({ ...req.body, entryId: Number(req.params.entryId) })
      .returning();
    res.status(201).json(pick);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/entries/:entryId/picks/:pickId", async (req, res): Promise<void> => {
  try {
    const [pick] = await db.update(entryPicksTable)
      .set(req.body)
      .where(and(
        eq(entryPicksTable.id, Number(req.params.pickId)),
        eq(entryPicksTable.entryId, Number(req.params.entryId)),
      ))
      .returning();
    if (!pick) {
      res.status(404).json({ error: "Pick not found" });
      return;
    }

    // Auto-record CLV when a pick result is first set to hit or miss
    const newResult = (req.body as Record<string, unknown>).result as string | undefined;
    if ((newResult === "hit" || newResult === "miss") && pick.playerId && pick.statType) {
      try {
        const [currentLine] = await db
          .select({ lineValue: ppLinesTable.lineValue })
          .from(ppLinesTable)
          .where(and(
            eq(ppLinesTable.playerId, pick.playerId),
            eq(ppLinesTable.statType, pick.statType),
            eq(ppLinesTable.isActive, true),
          ))
          .limit(1);

        if (currentLine) {
          const lockedLine  = Number(pick.lineValue);
          const closingLine = Number(currentLine.lineValue);
          const lineMove    = closingLine - lockedLine;
          // Positive CLV = line moved in bettor's favour
          const clv         = pick.direction === "more" ? lineMove : -lineMove;

          await db.insert(clvRecordsTable).values({
            entryPickId: pick.id,
            ppLineId:    pick.ppLineId,
            lockedLine:  String(lockedLine),
            closingLine: String(closingLine),
            clv:         String(clv),
            direction:   pick.direction,
          });

          // Persist closingLine + clv back onto the pick row
          await db.update(entryPicksTable)
            .set({ closingLine: String(closingLine), clv: String(clv) })
            .where(eq(entryPicksTable.id, pick.id));
        }
      } catch (clvErr) {
        req.log.warn({ err: clvErr }, "CLV auto-record failed (non-fatal)");
      }
    }

    res.json(pick);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/entries/:entryId/picks/:pickId", async (req, res) => {
  try {
    await db.delete(entryPicksTable)
      .where(and(
        eq(entryPicksTable.id, Number(req.params.pickId)),
        eq(entryPicksTable.entryId, Number(req.params.entryId)),
      ));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
