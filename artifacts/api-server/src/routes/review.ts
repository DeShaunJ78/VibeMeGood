import { Router } from "express";
import { db } from "@workspace/db";
import { entriesTable, entryPicksTable } from "@workspace/db/schema";
import { and, gte, lte, type SQL } from "drizzle-orm";

const router = Router();

router.get("/dashboard/review", async (req, res) => {
  try {
    const { since, until } = req.query as Record<string, string>;
    const entryConditions: SQL[] = [];
    if (since) entryConditions.push(gte(entriesTable.entryDate, since));
    if (until) entryConditions.push(lte(entriesTable.entryDate, until));

    const entries = entryConditions.length
      ? await db.select().from(entriesTable).where(and(...entryConditions))
      : await db.select().from(entriesTable);

    const picks = await db.select().from(entryPicksTable);

    const completedEntries = entries.filter(e => e.result !== "pending");
    const totalEntries = completedEntries.length;
    const wins = completedEntries.filter(e => e.result === "win").length;
    const overallHitRate = totalEntries > 0 ? wins / totalEntries : null;

    // Bankroll curve (cumulative, starting at $1000)
    const sortedEntries = [...completedEntries].sort(
      (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
    );
    let bankroll = 1000;
    const bankrollCurve = sortedEntries.map(e => {
      const stake = Number(e.stake ?? 0);
      const payout = Number(e.actualPayout ?? 0);
      bankroll = bankroll - stake + payout;
      return { date: e.entryDate, balance: Math.round(bankroll * 100) / 100, result: e.result };
    });

    // Monthly P&L
    const monthlyMap: Record<string, { pnl: number; entries: number; wins: number }> = {};
    for (const e of completedEntries) {
      const month = e.entryDate.slice(0, 7); // YYYY-MM
      if (!monthlyMap[month]) monthlyMap[month] = { pnl: 0, entries: 0, wins: 0 };
      monthlyMap[month].entries++;
      const pnl = Number(e.actualPayout ?? 0) - Number(e.stake ?? 0);
      monthlyMap[month].pnl += pnl;
      if (e.result === "win") monthlyMap[month].wins++;
    }
    const monthlyPnl = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        label: new Date(month + "-01").toLocaleString("en-US", { month: "short", year: "2-digit" }),
        pnl: Math.round(d.pnl * 100) / 100,
        entries: d.entries,
        wins: d.wins,
      }));

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

    // Model accuracy: projectionGap direction vs actual hit/miss
    const modelPicks = completedPicks.filter(
      p => p.projectionGap !== null && (p.result === "hit" || p.result === "miss")
    );
    const modelCorrect = modelPicks.filter(p => {
      const gap = Number(p.projectionGap);
      // For "more" picks: positive gap = model expects over = hit is correct
      // For "less" picks: negative gap = model expects under = hit is correct
      if (p.direction === "more") return gap > 0 ? p.result === "hit" : p.result === "miss";
      if (p.direction === "less") return gap < 0 ? p.result === "hit" : p.result === "miss";
      return false;
    });
    const modelAccuracy = {
      total: modelPicks.length,
      correct: modelCorrect.length,
      rate: modelPicks.length > 0 ? modelCorrect.length / modelPicks.length : null,
    };

    // Emotional state win rates
    const emotionMap: Record<string, { wins: number; total: number }> = {};
    for (const e of completedEntries) {
      const em = e.emotionalState ?? "unknown";
      if (!emotionMap[em]) emotionMap[em] = { wins: 0, total: 0 };
      emotionMap[em].total++;
      if (e.result === "win") emotionMap[em].wins++;
    }
    const emotionWinRates = Object.entries(emotionMap)
      .map(([emotion, d]) => ({
        emotion,
        wins: d.wins,
        total: d.total,
        rate: d.total > 0 ? d.wins / d.total : null,
      }))
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

    res.json({
      totalEntries,
      overallHitRate,
      totalPnl,
      bankrollCurve,
      monthlyPnl,
      hitRateByPickCount,
      hitRateByEntryType,
      pickHitRate,
      avgClv,
      modelAccuracy,
      emotionWinRates,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
