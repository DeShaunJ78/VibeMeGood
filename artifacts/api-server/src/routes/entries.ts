import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  entriesTable, entryPicksTable, playersTable, ppLinesTable, clvRecordsTable,
  behavioralLogsTable, userSettingsTable, type InsertEntry,
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, desc, type SQL } from "drizzle-orm";
import { broadcast } from "../lib/sse";

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 6)  return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

async function getMinutesSinceLastLoss(): Promise<number | null> {
  const [lastLoss] = await db
    .select({ closedAt: entriesTable.closedAt, submittedAt: entriesTable.submittedAt })
    .from(entriesTable)
    .where(eq(entriesTable.result, "loss"))
    .orderBy(desc(entriesTable.id))
    .limit(1);
  if (!lastLoss) return null;
  const t = lastLoss.closedAt ?? lastLoss.submittedAt;
  if (!t) return null;
  return Math.floor((Date.now() - new Date(t).getTime()) / 60_000);
}

async function getRecentAverageStake(n: number): Promise<number> {
  const recent = await db
    .select({ stake: entriesTable.stake })
    .from(entriesTable)
    .orderBy(desc(entriesTable.id))
    .limit(n);
  if (!recent.length) return 0;
  return recent.reduce((sum, e) => sum + Number(e.stake), 0) / recent.length;
}

async function getTodayLoss(today: string): Promise<number> {
  const losses = await db
    .select({ stake: entriesTable.stake })
    .from(entriesTable)
    .where(and(eq(entriesTable.result, "loss"), eq(entriesTable.entryDate, today)));
  return losses.reduce((sum, e) => sum + Number(e.stake), 0);
}

const router = Router();

const CreateEntrySchema = z.object({
  stake: z.number().positive().max(10000),
  entryType: z.enum(["power", "flex"]),
  pickCount: z.number().int().min(2).max(6),
  entryDate: z.string().optional(),
  notes: z.string().max(500).optional().nullable(),
  displayedPayoutMultiplier: z.number().nullable().optional(),
  potentialPayout: z.number().nullable().optional(),
});

const PickResultSchema = z.object({
  result: z.enum(["hit", "miss", "dnp"]),
  closingLine: z.number().positive().optional(),
}).passthrough();

router.get("/entries/loss-limit-status", async (req, res): Promise<void> => {
  try {
    const userId = (req.query.userId as string) ?? "default";
    const [settings] = await db
      .select({ dailyLossLimit: userSettingsTable.dailyLossLimit })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1);
    const limit = settings?.dailyLossLimit ? Number(settings.dailyLossLimit) : null;
    if (limit === null) {
      res.json({ exceeded: false, totalLoss: 0, limit: null });
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const totalLoss = await getTodayLoss(today);
    res.json({ exceeded: totalLoss >= limit, totalLoss, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/entries", async (req, res) => {
  try {
    const { result, entryType, since, dateFrom, dateTo, sport, search } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (result) conditions.push(eq(entriesTable.result, result));
    if (entryType) conditions.push(eq(entriesTable.entryType, entryType));
    // dateFrom / dateTo take precedence over legacy `since`
    const from = dateFrom ?? since;
    if (from) conditions.push(gte(entriesTable.entryDate, from));
    if (dateTo) conditions.push(lte(entriesTable.entryDate, dateTo));

    // sport filter: find entries where at least one pick's player has that sport
    if (sport) {
      const sportPicks = await db
        .select({ entryId: entryPicksTable.entryId })
        .from(entryPicksTable)
        .innerJoin(playersTable, eq(entryPicksTable.playerId, playersTable.id))
        .where(eq(playersTable.sport, sport));
      const sportEntryIds = [...new Set(sportPicks.map(r => r.entryId))];
      if (sportEntryIds.length === 0) {
        res.json([]);
        return;
      }
      conditions.push(inArray(entriesTable.id, sportEntryIds));
    }

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

router.post("/entries", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const userId = (body.userId as string) ?? "default";

    // Strip non-schema keys before validation
    const { userId: _u, overrideLossLimit: _o, ...entryBody } = body;
    const parsed = CreateEntrySchema.safeParse(entryBody);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", issues: parsed.error.issues });
      return;
    }

    const entryData = entryBody;
    const [entry] = await db.insert(entriesTable).values(entryData as InsertEntry).returning();

    // Async behavioral logging — non-fatal
    void (async () => {
      try {
        const [settings] = await db
          .select({ unitSize: userSettingsTable.unitSize })
          .from(userSettingsTable)
          .where(eq(userSettingsTable.userId, userId))
          .limit(1);
        const unitSize   = settings?.unitSize ? Number(settings.unitSize) : 25;
        const stake      = Number(entry.stake);
        const minutesSinceLastLoss = await getMinutesSinceLastLoss();
        const recentAvgStake       = await getRecentAverageStake(10);
        const stakeMultiple        = unitSize > 0 ? stake / unitSize : null;

        await db.insert(behavioralLogsTable).values({
          userId,
          entryId:              entry.id,
          timeOfDay:            getTimeOfDay(),
          minutesSinceLastLoss: minutesSinceLastLoss ?? undefined,
          stakeMultipleOfUnit:  stakeMultiple !== null ? String(stakeMultiple) : undefined,
          deviatedFromOptimizer:    false,
          picksChangedFromOptimizer: 0,
        });

        if (minutesSinceLastLoss !== null && minutesSinceLastLoss < 15) {
          broadcast("tilt_warning", {
            message: `You placed this entry ${minutesSinceLastLoss} minute${minutesSinceLastLoss === 1 ? "" : "s"} after your last loss. Tilt is the #1 killer of bankrolls.`,
            severity: "warning",
            timestamp: new Date().toISOString(),
          });
        }

        if (recentAvgStake > 0 && stake >= recentAvgStake * 2) {
          broadcast("stake_escalation", {
            message: `This stake ($${stake}) is ${(stake / recentAvgStake).toFixed(1)}x your recent average ($${recentAvgStake.toFixed(0)}). Confirm this is intentional.`,
            severity: "warning",
            timestamp: new Date().toISOString(),
          });
        }
      } catch (logErr) {
        req.log.warn({ err: logErr }, "Behavioral logging failed (non-fatal)");
      }
    })();

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
  const pickId  = Number(req.params.pickId);
  const entryId = Number(req.params.entryId);

  const parsed = PickResultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", issues: parsed.error.issues });
    return;
  }

  try {
    let resultPick: typeof entryPicksTable.$inferSelect | null = null;

    await db.transaction(async (tx) => {
      const [pick] = await tx.update(entryPicksTable)
        .set(req.body as Record<string, unknown>)
        .where(and(
          eq(entryPicksTable.id, pickId),
          eq(entryPicksTable.entryId, entryId),
        ))
        .returning();

      if (!pick) return; // resultPick stays null → 404

      resultPick = pick;

      // Auto-record CLV when result is first set to hit or miss
      const newResult = parsed.data.result;
      if ((newResult === "hit" || newResult === "miss") && pick.playerId && pick.statType) {
        const [currentLine] = await tx
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
          const clv         = pick.direction === "more" ? lineMove : -lineMove;

          await tx.insert(clvRecordsTable).values({
            entryPickId: pick.id,
            ppLineId:    pick.ppLineId,
            lockedLine:  String(lockedLine),
            closingLine: String(closingLine),
            clv:         String(clv),
            direction:   pick.direction,
          });

          await tx.update(entryPicksTable)
            .set({ closingLine: String(closingLine), clv: String(clv) })
            .where(eq(entryPicksTable.id, pick.id));

          resultPick = { ...pick, closingLine: String(closingLine), clv: String(clv) };
        }
      }
    });

    if (!resultPick) {
      res.status(404).json({ error: "Pick not found" });
      return;
    }

    res.json(resultPick);
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
