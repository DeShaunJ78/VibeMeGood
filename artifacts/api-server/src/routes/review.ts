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

    // Stat-type breakdown — scoped to the same filtered entry set, hit/miss only, min 3 picks
    const completedEntryIds = new Set(completedEntries.map(e => e.id));
    const gradedPicks = picks.filter(p =>
      completedEntryIds.has(p.entryId) && (p.result === "hit" || p.result === "miss")
    );
    const statMap: Record<string, { hits: number; total: number; edgeSum: number; edgeCount: number }> = {};
    for (const p of gradedPicks) {
      const st = p.statType;
      if (!statMap[st]) statMap[st] = { hits: 0, total: 0, edgeSum: 0, edgeCount: 0 };
      statMap[st].total++;
      if (p.result === "hit") statMap[st].hits++;
      if (p.snapshotEdgeScore != null) {
        statMap[st].edgeSum += Number(p.snapshotEdgeScore);
        statMap[st].edgeCount++;
      }
    }
    const statBreakdown = Object.entries(statMap)
      .filter(([, d]) => d.total >= 3)
      .map(([statType, d]) => ({
        statType,
        pickCount: d.total,
        hitCount: d.hits,
        hitRate: d.total > 0 ? Math.round((d.hits / d.total) * 1000) / 1000 : null,
        avgEdge: d.edgeCount > 0 ? Math.round((d.edgeSum / d.edgeCount) * 10) / 10 : null,
      }))
      .sort((a, b) => b.pickCount - a.pickCount);

    // Pick-level stats
    const completedPicks = picks.filter(p => p.result !== "pending");
    const hitPicks = completedPicks.filter(p => p.result === "hit");
    const pickHitRate = completedPicks.length > 0 ? hitPicks.length / completedPicks.length : null;

    // CLV stats — only include legs where closing_line was tracked (clv IS NOT NULL)
    const clvPicks = completedPicks.filter(p => p.clv !== null);
    const avgClv = clvPicks.length > 0
      ? clvPicks.reduce((sum, p) => sum + Number(p.clv ?? 0), 0) / clvPicks.length
      : null;
    const clvCoverage = completedPicks.length > 0 ? clvPicks.length / completedPicks.length : null;

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

    // CLV coverage by month — group graded picks by entry month
    const entryDateMap = new Map(entries.map(e => [e.id, e.entryDate]));
    const clvMonthMap: Record<string, { total: number; covered: number; clvSum: number }> = {};
    for (const p of completedPicks.filter(p => p.result === "hit" || p.result === "miss")) {
      const entryDate = entryDateMap.get(p.entryId);
      if (!entryDate) continue;
      const month = entryDate.slice(0, 7);
      if (!clvMonthMap[month]) clvMonthMap[month] = { total: 0, covered: 0, clvSum: 0 };
      clvMonthMap[month].total++;
      if (p.clv !== null) {
        clvMonthMap[month].covered++;
        clvMonthMap[month].clvSum += Number(p.clv);
      }
    }
    const clvCoverageByMonth = Object.entries(clvMonthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        label: new Date(month + "-01").toLocaleString("en-US", { month: "short", year: "2-digit" }),
        total: d.total,
        covered: d.covered,
        coverage: d.total > 0 ? Math.round((d.covered / d.total) * 1000) / 1000 : null,
        avgClv: d.covered > 0 ? Math.round((d.clvSum / d.covered) * 100) / 100 : null,
      }));

    // Kelly adherence: entries where kellySuggested is recorded, fraction with stake ≤ kellySuggested × 1.10
    const kellyEntries = entries.filter(e => e.kellySuggested != null);
    const kellyAdherent = kellyEntries.filter(e =>
      Number(e.stake) <= Number(e.kellySuggested) * 1.10
    );
    const kellyAdherenceRate = kellyEntries.length > 0 ? kellyAdherent.length / kellyEntries.length : null;

    // Kelly adherence by month — group kellyEntries by YYYY-MM, compute rate per month
    const kellyMonthMap: Record<string, { count: number; adherent: number }> = {};
    for (const e of kellyEntries) {
      const month = e.entryDate.slice(0, 7);
      if (!kellyMonthMap[month]) kellyMonthMap[month] = { count: 0, adherent: 0 };
      kellyMonthMap[month].count++;
      if (Number(e.stake) <= Number(e.kellySuggested) * 1.10) {
        kellyMonthMap[month].adherent++;
      }
    }
    const kellyAdherenceByMonth = Object.entries(kellyMonthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month,
        label: new Date(month + "-01").toLocaleString("en-US", { month: "short", year: "2-digit" }),
        count: d.count,
        adherent: d.adherent,
        rate: d.count > 0 ? Math.round((d.adherent / d.count) * 1000) / 1000 : null,
      }));

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
      clvCoverage,
      kellyAdherenceRate,
      kellyAdherenceByMonth,
      clvCoverageByMonth,
      modelAccuracy,
      emotionWinRates,
      statBreakdown,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GPP Backtest ─────────────────────────────────────────────────────────────
// Compares entries tagged optimizationObjective='gpp_mode' against all others.
// Metrics: hit rate, avg payout multiple (actualPayout/stake), tail outcomes
// (top-10% payout multiple events), and hit-rate breakdown by pick count.

function buildBacktestGroup(label: string, entries: typeof entriesTable.$inferSelect[]) {
  const completed = entries.filter(e => e.result !== "pending");
  const wins = completed.filter(e => e.result === "win");

  const totalPnl = completed.reduce((sum, e) => {
    return sum + Number(e.actualPayout ?? 0) - Number(e.stake ?? 0);
  }, 0);

  // Payout multiples for completed winning entries (win only has meaningful payout)
  const multiples = completed
    .filter(e => Number(e.stake ?? 0) > 0 && Number(e.actualPayout ?? 0) > 0)
    .map(e => Number(e.actualPayout) / Number(e.stake));

  const avgPayoutMultiple = multiples.length > 0
    ? multiples.reduce((a, b) => a + b, 0) / multiples.length
    : null;

  // Tail: top 10% of payout multiples
  const sorted = [...multiples].sort((a, b) => b - a);
  const tailCut = Math.max(1, Math.ceil(sorted.length * 0.10));
  const tailSlice = sorted.slice(0, tailCut);
  const tailThreshold = sorted.length > 0 ? sorted[tailCut - 1] ?? null : null;
  const avgTailMultiple = tailSlice.length > 0
    ? tailSlice.reduce((a, b) => a + b, 0) / tailSlice.length
    : null;

  // Hit rate by pick count
  const pcMap: Record<number, { wins: number; total: number }> = {};
  for (const e of completed) {
    const pc = e.pickCount;
    if (!pcMap[pc]) pcMap[pc] = { wins: 0, total: 0 };
    pcMap[pc].total++;
    if (e.result === "win") pcMap[pc].wins++;
  }
  const hitRateByPickCount = Object.entries(pcMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([pickCount, d]) => ({
      pickCount: Number(pickCount),
      wins: d.wins,
      total: d.total,
      hitRate: d.total > 0 ? Math.round((d.wins / d.total) * 1000) / 1000 : null,
    }));

  return {
    label,
    totalEntries: entries.length,
    completedEntries: completed.length,
    wins: wins.length,
    hitRate: completed.length > 0 ? Math.round((wins.length / completed.length) * 1000) / 1000 : null,
    avgPayoutMultiple: avgPayoutMultiple != null ? Math.round(avgPayoutMultiple * 100) / 100 : null,
    totalPnl: Math.round(totalPnl * 100) / 100,
    tailCount: tailSlice.length,
    tailThreshold: tailThreshold != null ? Math.round(tailThreshold * 100) / 100 : null,
    avgTailMultiple: avgTailMultiple != null ? Math.round(avgTailMultiple * 100) / 100 : null,
    hitRateByPickCount,
  };
}

router.get("/dashboard/gpp-backtest", async (req, res) => {
  try {
    const allEntries = await db.select().from(entriesTable);

    const gppEntries = allEntries.filter(e => e.optimizationObjective === "gpp_mode");
    const standardEntries = allEntries.filter(e => e.optimizationObjective !== "gpp_mode");

    res.json({
      gpp: buildBacktestGroup("GPP Mode", gppEntries),
      standard: buildBacktestGroup("Standard", standardEntries),
      hasGppData: gppEntries.length > 0,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
