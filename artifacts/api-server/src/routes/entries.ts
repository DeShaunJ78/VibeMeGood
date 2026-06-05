import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  entriesTable, entryPicksTable, playersTable, ppLinesTable, clvRecordsTable,
  ppLineHistoryTable, ourProjectionsTable, propScoresTable,
  behavioralLogsTable, userSettingsTable, type InsertEntry,
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, desc, type SQL } from "drizzle-orm";
import { broadcast } from "../lib/sse";

// Snapshot the current model projection onto each pick at log time. The model
// projection (our_projections.projectedValue) is exactly what the Slate Board and
// Lineup Factory use live; capturing it here means the Journal, AI entry analysis,
// and CLV/review math all run off the same numbers — and it does NOT depend on the
// client remembering to send a projection. our_projections is unique per
// (playerId, statType), so the lookup is unambiguous. Picks that already carry an
// explicit projection, or have no matching player+stat row, are left untouched.
async function enrichPicksWithProjections<T extends {
  playerId?: number | null;
  statType: string;
  lineValue: number;
  yourProjection?: number | null;
  projectionGap?: number | null;
}>(picks: T[]): Promise<T[]> {
  const playerIds = [...new Set(
    picks.filter(p => p.playerId != null && p.yourProjection == null).map(p => p.playerId as number),
  )];
  if (playerIds.length === 0) return picks;

  const rows = await db
    .select({
      playerId: ourProjectionsTable.playerId,
      statType: ourProjectionsTable.statType,
      projectedValue: ourProjectionsTable.projectedValue,
    })
    .from(ourProjectionsTable)
    .where(inArray(ourProjectionsTable.playerId, playerIds));

  const projByKey = new Map<string, number>();
  for (const r of rows) {
    if (r.playerId == null || r.projectedValue == null) continue;
    projByKey.set(`${r.playerId}|${r.statType}`, Number(r.projectedValue));
  }

  return picks.map(p => {
    if (p.yourProjection != null || p.playerId == null) return p;
    const projected = projByKey.get(`${p.playerId}|${p.statType}`);
    if (projected == null) return p;
    return {
      ...p,
      yourProjection: projected,
      projectionGap: Math.round((projected - p.lineValue) * 100) / 100,
    };
  });
}

async function settlePickCLV(pick: {
  id: number;
  ppLineId: number | null;
  lineValue: string;
}): Promise<void> {
  if (!pick.ppLineId) return;

  const [closing] = await db
    .select()
    .from(ppLineHistoryTable)
    .where(eq(ppLineHistoryTable.ppLineId, pick.ppLineId))
    .orderBy(desc(ppLineHistoryTable.capturedAt))
    .limit(1);

  if (!closing) return;

  const closingLine = Number(closing.lineValue);
  const entryLine   = Number(pick.lineValue);
  const clv         = closingLine - entryLine;

  await db
    .update(entryPicksTable)
    .set({ closingLine: closingLine.toString(), clv: clv.toString() })
    .where(eq(entryPicksTable.id, pick.id));
}

// ── Tier classification — mirrors the client-side logic in slate-board.tsx ──
function edgeToTier(edge: number): string {
  if (edge >= 43) return "A";
  if (edge >= 30) return "B";
  if (edge >= 20) return "C";
  return "D";
}

// Snapshot the current edge score and tier for each pick that references a
// ppLineId. Picks without a ppLineId (manual slips) or with no prop_scores row
// get null — that is correct, not a missing-data bug.
async function enrichPicksWithEdgeSnapshot<T extends {
  ppLineId?: number | null;
  snapshotEdgeScore?: number | null;
  snapshotTier?: string | null;
}>(picks: T[]): Promise<T[]> {
  const ppLineIds = [...new Set(
    picks.filter(p => p.ppLineId != null && p.snapshotEdgeScore == null).map(p => p.ppLineId as number),
  )];
  if (ppLineIds.length === 0) return picks;

  const rows = await db
    .select({ ppLineId: propScoresTable.ppLineId, edgeScore: propScoresTable.edgeScore })
    .from(propScoresTable)
    .where(inArray(propScoresTable.ppLineId, ppLineIds));

  const edgeByLine = new Map<number, number>();
  for (const r of rows) {
    if (r.ppLineId != null && r.edgeScore != null) {
      edgeByLine.set(r.ppLineId, Number(r.edgeScore));
    }
  }

  return picks.map(p => {
    if (p.ppLineId == null || p.snapshotEdgeScore != null) return p;
    const edge = edgeByLine.get(p.ppLineId);
    if (edge == null) return p;
    return { ...p, snapshotEdgeScore: edge, snapshotTier: edgeToTier(edge) };
  });
}

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
  // Half-Kelly dollar amount at log time, computed client-side where pick pOver + multiplier live.
  kellySuggested: z.number().positive().nullable().optional(),
});

const InlinePickSchema = z.object({
  ppLineId:       z.number().int().nullable().optional(),
  playerId:       z.number().int().nullable().optional(),
  playerName:     z.string().max(120).nullable().optional(),
  gameId:         z.number().int().nullable().optional(),
  statType:       z.string(),
  direction:      z.enum(["more", "less"]),
  lineValue:      z.number(),
  lineType:       z.string(),
  result:         z.enum(["pending", "hit", "miss", "dnp"]).optional(),
  yourProjection: z.number().nullable().optional(),
  projectionGap:  z.number().nullable().optional(),
});

const PickResultSchema = z.object({
  result: z.enum(["hit", "miss", "dnp"]),
  closingLine: z.number().positive().optional(),
}).passthrough();

router.get("/entries/today-summary", async (req, res): Promise<void> => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const rows = await db
      .select({ stake: entriesTable.stake })
      .from(entriesTable)
      .where(eq(entriesTable.entryDate, today));
    const totalStake = rows.reduce((s, r) => s + Number(r.stake ?? 0), 0);
    res.json({ todayStake: Math.round(totalStake * 100) / 100, entryCount: rows.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
    const allPlayerIds = [...new Set(allPicks.map(p => p.playerId).filter((x): x is number => x != null))];
    const allPlayers = allPlayerIds.length
      ? await db.select({ id: playersTable.id, fullName: playersTable.fullName })
          .from(playersTable).where(inArray(playersTable.id, allPlayerIds))
      : [];
    const playerNameMap = Object.fromEntries(allPlayers.map(p => [p.id, p.fullName]));
    const picksByEntry: Record<number, typeof allPicks> = {};
    for (const pick of allPicks) {
      if (!picksByEntry[pick.entryId]) picksByEntry[pick.entryId] = [];
      picksByEntry[pick.entryId].push({ ...pick, playerName: (pick.playerId != null ? playerNameMap[pick.playerId] : null) ?? pick.playerName ?? null } as any);
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

    // Strip non-schema keys before validation. `picks` (optional) are persisted
    // atomically with the entry below, never inserted onto the entries row.
    const { userId: _u, overrideLossLimit: _o, picks: rawPicks, ...entryBody } = body;
    const parsed = CreateEntrySchema.safeParse(entryBody);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", issues: parsed.error.issues });
      return;
    }

    let picksToInsert: z.infer<typeof InlinePickSchema>[] = [];
    if (rawPicks !== undefined) {
      const picksParsed = z.array(InlinePickSchema).safeParse(rawPicks);
      if (!picksParsed.success) {
        res.status(400).json({ error: "Invalid picks", issues: picksParsed.error.issues });
        return;
      }
      picksToInsert = picksParsed.data;
      // A manual slip is 2–6 legs; reject malformed payloads server-side so
      // integrity never depends solely on the client.
      if (picksToInsert.length > 0 && (picksToInsert.length < 2 || picksToInsert.length > 6)) {
        res.status(400).json({ error: "A slip must have between 2 and 6 picks" });
        return;
      }
    }

    // Snapshot model projections server-side so every logged leg carries the same
    // numbers the Slate Board showed — bulletproof against a client that omits them.
    picksToInsert = await enrichPicksWithProjections(picksToInsert);

    // Snapshot edge scores + tiers at log time — independent of future rescore runs.
    picksToInsert = await enrichPicksWithEdgeSnapshot(picksToInsert);

    // Freeze bankroll + unit size at log time. Settings can change; historical
    // records must reflect what the system recommended when the bet was made.
    const [settingsRow] = await db
      .select({ bankroll: userSettingsTable.bankroll, unitSize: userSettingsTable.unitSize })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1);
    const snapshotBankroll  = settingsRow?.bankroll  ? Number(settingsRow.bankroll)  : 500;
    const snapshotUnitSize  = settingsRow?.unitSize   ? Number(settingsRow.unitSize)  : 5;

    // Suggested stake = highest-tier pick's multiplier × unit size.
    // Tier A=5u, B=2u, C=1u, D=0 → default to 1u if all D.
    const tierUnits: Record<string, number> = { A: 5, B: 2, C: 1, D: 0 };
    const dominantTier = picksToInsert.reduce<string>((best, p) => {
      const t = (p as { snapshotTier?: string | null }).snapshotTier ?? "D";
      const bestOrder = ["A", "B", "C", "D"].indexOf(best);
      const thisOrder = ["A", "B", "C", "D"].indexOf(t);
      return thisOrder < bestOrder ? t : best;
    }, "D");
    const suggestedUnits = tierUnits[dominantTier] ?? 1;
    const snapshotSuggestedStake = Math.max(snapshotUnitSize, suggestedUnits * snapshotUnitSize);

    // Entry + legs are created in a single transaction so a leg failure rolls back
    // the whole entry — never leaves an ungradeable entry with zero picks.
    const entry = await db.transaction(async (tx) => {
      const { kellySuggested: ksSrc, ...restBody } = entryBody as InsertEntry & { kellySuggested?: number | null };
      const [created] = await tx.insert(entriesTable).values({
        ...(restBody as InsertEntry),
        snapshotBankroll:       String(snapshotBankroll),
        snapshotUnitSize:       String(snapshotUnitSize),
        snapshotSuggestedStake: String(snapshotSuggestedStake),
        kellySuggested:         ksSrc != null ? String(ksSrc) : null,
      }).returning();
      if (picksToInsert.length > 0) {
        await tx.insert(entryPicksTable).values(
          picksToInsert.map(p => ({
            entryId:            created.id,
            ppLineId:           p.ppLineId ?? null,
            playerId:           p.playerId ?? null,
            playerName:         p.playerName ?? null,
            gameId:             p.gameId ?? null,
            statType:           p.statType,
            direction:          p.direction,
            lineValue:          String(p.lineValue),
            lineType:           p.lineType,
            result:             p.result ?? "pending",
            yourProjection:     p.yourProjection != null ? String(p.yourProjection) : null,
            projectionGap:      p.projectionGap != null ? String(p.projectionGap) : null,
            snapshotEdgeScore:  (p as { snapshotEdgeScore?: number | null }).snapshotEdgeScore != null
              ? String((p as { snapshotEdgeScore?: number | null }).snapshotEdgeScore)
              : null,
            snapshotTier:       (p as { snapshotTier?: string | null }).snapshotTier ?? null,
          })),
        );
      }
      return created;
    });

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

// ── CSV Export ──────────────────────────────────────────────────────────────
// One row per pick leg, same filter params as GET /entries.
// MUST be declared before /:id so Express doesn't swallow "export.csv" as id.
function csvEsc(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r"))
    ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvEsc).join(",") + "\r\n";
}

// ── Column-group definitions ─────────────────────────────────────────────────
type CsvColGroup = "meta" | "picks" | "financials" | "projections";
const ALL_GROUPS: CsvColGroup[] = ["meta", "picks", "financials", "projections"];

interface CsvColCtx {
  entry: typeof entriesTable.$inferSelect;
  pick: typeof entryPicksTable.$inferSelect;
  playerName: string;
  pickSport: string;
  stake: number;
  actualPayout: number;
  pnl: number | null;
  pOver: string | null;
}

const CSV_COLS: { header: string; group: CsvColGroup; value: (c: CsvColCtx) => unknown }[] = [
  // meta
  { header: "date",          group: "meta",        value: c => c.entry.entryDate },
  { header: "entry_result",  group: "meta",        value: c => c.entry.result ?? "pending" },
  { header: "entry_type",    group: "meta",        value: c => c.entry.entryType },
  { header: "playstyle",     group: "meta",        value: c => c.entry.entryType },
  { header: "notes",         group: "meta",        value: c => c.entry.notes ?? "" },
  // picks
  { header: "sport",         group: "picks",       value: c => c.pickSport },
  { header: "player",        group: "picks",       value: c => c.playerName },
  { header: "stat_type",     group: "picks",       value: c => c.pick.statType },
  { header: "line_value",    group: "picks",       value: c => c.pick.lineValue },
  { header: "direction",     group: "picks",       value: c => c.pick.direction },
  { header: "pick_result",   group: "picks",       value: c => c.pick.result ?? "pending" },
  // financials
  { header: "stake",         group: "financials",  value: c => c.stake.toFixed(2) },
  { header: "actual_payout", group: "financials",  value: c => c.entry.result !== "pending" ? c.actualPayout.toFixed(2) : "" },
  { header: "pnl",           group: "financials",  value: c => c.pnl != null ? c.pnl.toFixed(2) : "" },
  // projections
  { header: "projection",    group: "projections", value: c => c.pick.yourProjection ?? "" },
  { header: "pover_pct",     group: "projections", value: c => c.pOver ?? "" },
  { header: "clv",           group: "projections", value: c => c.pick.clv != null ? Number(c.pick.clv).toFixed(2) : "" },
];

router.get("/entries/export.csv", async (req, res): Promise<void> => {
  try {
    const { result: resultFilter, entryType, since, dateFrom, dateTo, sport, search, cols } = req.query as Record<string, string>;

    // ── 0. Resolve active column groups ─────────────────────────────────────
    const activeGroups: Set<CsvColGroup> = cols
      ? new Set(cols.split(",").map(s => s.trim()).filter((s): s is CsvColGroup => ALL_GROUPS.includes(s as CsvColGroup)))
      : new Set(ALL_GROUPS);
    if (activeGroups.size === 0) activeGroups.add("meta"); // always at least one group
    const activeCols = CSV_COLS.filter(c => activeGroups.has(c.group));
    const headerRow  = activeCols.map(c => c.header);

    // ── 1. Filter entries (same logic as GET /entries) ──────────────────────
    const conditions: SQL[] = [];
    if (resultFilter) conditions.push(eq(entriesTable.result, resultFilter));
    if (entryType)    conditions.push(eq(entriesTable.entryType, entryType));
    const from = dateFrom ?? since;
    if (from)   conditions.push(gte(entriesTable.entryDate, from));
    if (dateTo) conditions.push(lte(entriesTable.entryDate, dateTo));

    if (sport) {
      const sportPicks = await db
        .select({ entryId: entryPicksTable.entryId })
        .from(entryPicksTable)
        .innerJoin(playersTable, eq(entryPicksTable.playerId, playersTable.id))
        .where(eq(playersTable.sport, sport));
      const sportEntryIds = [...new Set(sportPicks.map(r => r.entryId))];
      if (sportEntryIds.length === 0) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="journal-export.csv"`);
        res.end(csvRow(headerRow));
        return;
      }
      conditions.push(inArray(entriesTable.id, sportEntryIds));
    }

    const allEntries = conditions.length
      ? await db.select().from(entriesTable).where(and(...conditions)).orderBy(desc(entriesTable.id))
      : await db.select().from(entriesTable).orderBy(desc(entriesTable.id));

    const filtered = search
      ? allEntries.filter(e => e.notes?.toLowerCase().includes(search.toLowerCase()))
      : allEntries;

    if (filtered.length === 0) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="journal-export.csv"`);
      res.end(csvRow(headerRow));
      return;
    }

    // ── 2. Batch-fetch picks, players, and projections ───────────────────────
    const entryIds = filtered.map(e => e.id);
    const allPicks = await db.select().from(entryPicksTable).where(inArray(entryPicksTable.entryId, entryIds));

    const playerIds = [...new Set(allPicks.map(p => p.playerId).filter((x): x is number => x != null))];
    const allPlayers = playerIds.length
      ? await db.select({ id: playersTable.id, fullName: playersTable.fullName, sport: playersTable.sport })
          .from(playersTable).where(inArray(playersTable.id, playerIds))
      : [];
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));

    const projRows = playerIds.length && activeGroups.has("projections")
      ? await db
          .select({ playerId: ourProjectionsTable.playerId, statType: ourProjectionsTable.statType, pOver: ourProjectionsTable.pOver })
          .from(ourProjectionsTable)
          .where(inArray(ourProjectionsTable.playerId, playerIds))
      : [];
    const pOverMap = new Map(projRows.map(r => [`${r.playerId}|${r.statType}`, r.pOver]));

    const picksByEntry = new Map<number, typeof allPicks>();
    for (const p of allPicks) {
      if (!picksByEntry.has(p.entryId)) picksByEntry.set(p.entryId, []);
      picksByEntry.get(p.entryId)!.push(p);
    }

    // ── 3. Stream CSV ────────────────────────────────────────────────────────
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="journal-export-${date}.csv"`);
    res.write(csvRow(headerRow));

    for (const entry of filtered) {
      const picks = picksByEntry.get(entry.id) ?? [];
      const stake        = Number(entry.stake ?? 0);
      const actualPayout = Number(entry.actualPayout ?? 0);
      const pnl =
        entry.result === "win"     ? actualPayout - stake :
        entry.result === "partial" ? actualPayout - stake :
        entry.result === "loss"    ? -stake : null;

      for (const pick of picks) {
        const player     = pick.playerId != null ? playerMap.get(pick.playerId) : null;
        const playerName = player?.fullName ?? pick.playerName ?? "";
        const pickSport  = player?.sport ?? "";
        const rawPOver   = pick.playerId != null ? pOverMap.get(`${pick.playerId}|${pick.statType}`) : null;
        const pOver      = rawPOver != null ? Number(rawPOver).toFixed(1) : null;

        const ctx: CsvColCtx = { entry, pick, playerName, pickSport, stake, actualPayout, pnl, pOver };
        res.write(csvRow(activeCols.map(c => c.value(ctx))));
      }
    }
    res.end();
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Export failed" });
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
    const playerIds = [...new Set(picks.map(p => p.playerId).filter((x): x is number => x != null))];
    const players = playerIds.length
      ? await db.select({ id: playersTable.id, fullName: playersTable.fullName })
          .from(playersTable).where(inArray(playersTable.id, playerIds))
      : [];
    const playerMap = Object.fromEntries(players.map(p => [p.id, p.fullName]));
    const enrichedPicks = picks.map(p => ({ ...p, playerName: (p.playerId != null ? playerMap[p.playerId] : null) ?? p.playerName ?? null }));

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
    const id = Number(req.params.id);
    await db.delete(behavioralLogsTable).where(eq(behavioralLogsTable.entryId, id));
    await db.delete(entryPicksTable).where(eq(entryPicksTable.entryId, id));
    await db.delete(entriesTable).where(eq(entriesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/entries/:entryId/picks", async (req, res) => {
  try {
    const picks = await db.select().from(entryPicksTable).where(eq(entryPicksTable.entryId, Number(req.params.entryId)));
    const playerIds = [...new Set(picks.map(p => p.playerId).filter((x): x is number => x != null))];
    const players = playerIds.length
      ? await db.select({ id: playersTable.id, fullName: playersTable.fullName })
          .from(playersTable).where(inArray(playersTable.id, playerIds))
      : [];
    const playerMap = Object.fromEntries(players.map(p => [p.id, p.fullName]));
    res.json(picks.map(p => ({ ...p, playerName: (p.playerId != null ? playerMap[p.playerId] : null) ?? p.playerName ?? null })));
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
        .set({ result: parsed.data.result, gradedBy: "manual", gradedAt: new Date() })
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
          }).onConflictDoUpdate({
            target: clvRecordsTable.entryPickId,
            set: {
              ppLineId:    pick.ppLineId,
              lockedLine:  String(lockedLine),
              closingLine: String(closingLine),
              clv:         String(clv),
              direction:   pick.direction,
            },
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

    // Settle CLV from line history for all result types (overrides active-line fallback)
    await settlePickCLV(resultPick);

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
