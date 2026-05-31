import { Router } from "express";
import { db } from "@workspace/db";
import { ppLinesTable, ppLineHistoryTable } from "@workspace/db/schema";
import { eq, and, type SQL } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// Manual hybrid overrides. `null` clears the override (falls back to synced value /
// auto estimate). Never mutates lineValue/lineType — those are the synced upsert key.
const overrideSchema = z.object({
  lineValueOverride: z.number().positive().nullable().optional(),
  payoutMultiplier: z.number().positive().nullable().optional(),
});

router.get("/pp-lines", async (req, res) => {
  try {
    const { playerId, gameId, statType, lineType, isActive } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (playerId) conditions.push(eq(ppLinesTable.playerId, Number(playerId)));
    if (gameId) conditions.push(eq(ppLinesTable.gameId, Number(gameId)));
    if (statType) conditions.push(eq(ppLinesTable.statType, statType));
    if (lineType) conditions.push(eq(ppLinesTable.lineType, lineType));
    if (isActive !== undefined) conditions.push(eq(ppLinesTable.isActive, isActive === "true"));

    const lines = conditions.length
      ? await db.select().from(ppLinesTable).where(and(...conditions))
      : await db.select().from(ppLinesTable);
    res.json(lines);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pp-lines", async (req, res) => {
  try {
    const [line] = await db.insert(ppLinesTable).values(req.body).returning();
    // Record history on creation
    await db.insert(ppLineHistoryTable).values({
      ppLineId: line.id,
      lineValue: line.lineValue,
      lineType: line.lineType,
      capturedAt: new Date(),
    });
    res.status(201).json(line);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pp-lines/:id", async (req, res) => {
  try {
    const [line] = await db.select().from(ppLinesTable).where(eq(ppLinesTable.id, Number(req.params.id)));
    if (!line) return void res.status(404).json({ error: "PP Line not found" });
    res.json(line);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/pp-lines/:id", async (req, res) => {
  try {
    const [existing] = await db.select().from(ppLinesTable).where(eq(ppLinesTable.id, Number(req.params.id)));
    if (!existing) return void res.status(404).json({ error: "PP Line not found" });

    const [line] = await db.update(ppLinesTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(ppLinesTable.id, Number(req.params.id)))
      .returning();

    // Record history if line value changed
    if (req.body.lineValue && String(req.body.lineValue) !== String(existing.lineValue)) {
      await db.insert(ppLineHistoryTable).values({
        ppLineId: line.id,
        lineValue: line.lineValue,
        lineType: line.lineType,
        capturedAt: new Date(),
      });
    }
    res.json(line);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/pp-lines/:id/overrides", async (req, res) => {
  try {
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: "Invalid override", details: parsed.error.flatten() });
    }
    const [existing] = await db.select().from(ppLinesTable).where(eq(ppLinesTable.id, Number(req.params.id)));
    if (!existing) return void res.status(404).json({ error: "PP Line not found" });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ("lineValueOverride" in parsed.data) {
      patch.lineValueOverride = parsed.data.lineValueOverride == null ? null : String(parsed.data.lineValueOverride);
    }
    if ("payoutMultiplier" in parsed.data) {
      patch.payoutMultiplier = parsed.data.payoutMultiplier == null ? null : String(parsed.data.payoutMultiplier);
    }

    const [line] = await db.update(ppLinesTable)
      .set(patch)
      .where(eq(ppLinesTable.id, Number(req.params.id)))
      .returning();
    res.json(line);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pp-lines/:id/history", async (req, res) => {
  try {
    const history = await db.select().from(ppLineHistoryTable)
      .where(eq(ppLineHistoryTable.ppLineId, Number(req.params.id)));
    res.json(history);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
