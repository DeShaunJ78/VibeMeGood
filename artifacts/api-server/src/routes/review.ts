import { Router } from "express";
import { db } from "@workspace/db";
import { entriesTable, entryPicksTable } from "@workspace/db/schema";
import { and, gte, lte, type SQL } from "drizzle-orm";

const router = Router();

router.get("/dashboard/review", async (req, res) => {
  try {
    const { since, until, entryType } = req.query as Record<string, string>;
    const entryConditions: SQL[] = [];
    if (since) entryConditions.push(gte(entriesTable.entryDate, since));
    if (until) entryConditions.push(lte(entriesTable.entryDate, until));
    if (entryType) entryConditions.push(and(gte(entriesTable.entryDate, since ?? "2000-01-01"))!);

    const entries = entryConditions.length
      ? await db.select().from(entriesTable).where(and(...entryConditions))
      : await db.select().from(entriesTable);

    const picks = await db.select().from(entryPicksTable);

    // Build hit rate by sport/stat/actionTag (based on picks)
    const completedEntries = entries.filter(e => e.result !== "pending");
    const totalEntries = completedEntries.length;
    const wins = completedEntries.filter(e => e.result === "win").length;
    const overallHitRate = totalEntries > 0 ? wins / totalEntries : null;

    // Bankroll curve by date
    const sortedEntries = [...completedEntries].sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
    let bankroll = 1000;
    const bankrollCurve = sortedEntries.map(e => {
      const stake = Number(e.stake ?? 0);
      const payout = Number(e.actualPayout ?? 0);
      bankroll = bankroll - stake + payout;
      return {
        date: e.entryDate,
        balance: Math.round(bankroll * 100) / 100,
        result: e.result,
      };
    });

    // Hit rate by pick count
    const hitRateByPickCount: Record<number, { wins: number; total: number; rate: number | null }> = {};
    for (const e of completedEntries) {
      const pc = e.pickCount;
      if (!hitRateByPickCount[pc]) hitRateByPickCount[pc] = { wins: 0, total: 0, rate: null };
      hitRateByPickCount[pc].total++;
      if (e.result === "win") hitRateByPickCount[pc].wins++;
    }
    for (const key of Object.keys(hitRateByPickCount)) {
      const obj = hitRateByPickCount[Number(key)];
      obj.rate = obj.total > 0 ? obj.wins / obj.total : null;
    }

    // Total P&L
    const totalPnl = completedEntries.reduce((sum, e) => {
      return sum + Number(e.actualPayout ?? 0) - Number(e.stake ?? 0);
    }, 0);

    // Hit rate by entry type
    const hitRateByEntryType: Record<string, { wins: number; total: number; rate: number | null }> = {};
    for (const e of completedEntries) {
      const et = e.entryType;
      if (!hitRateByEntryType[et]) hitRateByEntryType[et] = { wins: 0, total: 0, rate: null };
      hitRateByEntryType[et].total++;
      if (e.result === "win") hitRateByEntryType[et].wins++;
    }
    for (const key of Object.keys(hitRateByEntryType)) {
      const obj = hitRateByEntryType[key];
      obj.rate = obj.total > 0 ? obj.wins / obj.total : null;
    }

    // Pick-level stats
    const completedPicks = picks.filter(p => p.result !== "pending");
    const hitPicks = completedPicks.filter(p => p.result === "hit");
    const pickHitRate = completedPicks.length > 0 ? hitPicks.length / completedPicks.length : null;

    // CLV stats
    const clvPicks = completedPicks.filter(p => p.clv !== null);
    const avgClv = clvPicks.length > 0
      ? clvPicks.reduce((sum, p) => sum + Number(p.clv ?? 0), 0) / clvPicks.length
      : null;

    res.json({
      totalEntries,
      overallHitRate,
      totalPnl,
      bankrollCurve,
      hitRateByPickCount,
      hitRateByEntryType,
      pickHitRate,
      avgClv,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
