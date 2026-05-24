import { db } from "@workspace/db";
import {
  ppLinesTable, playersTable, gamesTable,
  fatigueDataTable, varianceScoresTable,
  gameEnvironmentTable, matchupHistoryTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { computeFatigueScore, computeBlowoutRisk, computeUsageDelta, computeEVModifier } from "./compute-variance";

export async function computeVarianceForLine(ppLineId: number): Promise<void> {
  const [row] = await db.select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.id, ppLineId));

  if (!row) return;
  const { line, player } = row;

  const game = line.gameId
    ? (await db.select().from(gamesTable).where(eq(gamesTable.id, line.gameId)))[0] ?? null
    : null;

  // 1. Fatigue — look up by player + today's date
  const today = new Date().toISOString().split("T")[0];
  const [fatigueRow] = await db.select().from(fatigueDataTable)
    .where(
      and(
        eq(fatigueDataTable.playerId, player.id),
        eq(fatigueDataTable.computedForDate, today),
      )
    )
    .orderBy(desc(fatigueDataTable.computedAt))
    .limit(1);

  const fatigueResult = fatigueRow && fatigueRow.fatigueScore !== null
    ? computeFatigueScore({
        daysRest: fatigueRow.daysRest ?? 2,
        isBackToBack: fatigueRow.isBackToBack ?? false,
        isThreeInFour: fatigueRow.isThreeInFour ?? false,
        travelMiles: fatigueRow.travelMiles ?? 0,
        timezoneShiftHours: fatigueRow.timezoneShiftHours ?? 0,
        prevGameMinutes: fatigueRow.prevGameMinutes ? parseFloat(fatigueRow.prevGameMinutes.toString()) : 0,
        prevGameWasOT: false,
        isEarlyGame: false,
      })
    : { score: 50, label: "No schedule data", warnings: [] as string[] };

  // 2. Environment / blowout
  const [envRow] = game
    ? await db.select().from(gameEnvironmentTable).where(eq(gameEnvironmentTable.gameId, game.id))
    : [null];

  const spread = game?.spread ? Math.abs(parseFloat(game.spread.toString())) : 0;
  const total = envRow?.gameTotal
    ? parseFloat(envRow.gameTotal.toString())
    : game?.total ? parseFloat(game.total.toString()) : 0;

  const blowoutResult = computeBlowoutRisk(spread, total, player.sport);

  // 3. Usage delta
  const usageResult = await computeUsageDelta(player.id, line.statType);

  // 4. Matchup
  let matchupScore = 50;
  let matchupLabel = "No historical matchup data";
  if (game && player.teamId) {
    const oppTeamId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
    const [matchup] = await db.select().from(matchupHistoryTable)
      .where(and(
        eq(matchupHistoryTable.playerId, player.id),
        eq(matchupHistoryTable.opponentTeamId, oppTeamId),
        eq(matchupHistoryTable.statType, line.statType),
      ));
    if (matchup && matchup.gamesPlayed && matchup.gamesPlayed >= 3) {
      const overRate = matchup.overRateAtCurrentLine ? parseFloat(matchup.overRateAtCurrentLine.toString()) : 0.5;
      matchupScore = Math.round(overRate * 100);
      matchupLabel = `${matchup.gamesPlayed} games vs this opponent — ${Math.round(overRate * 100)}% over rate`;
    }
  }

  // 5. Composite warnings
  const warnings = [
    ...fatigueResult.warnings,
    ...(blowoutResult.warning ? [blowoutResult.warning] : []),
    ...(usageResult.minutesTrend === "down" ? ["minutes_risk"] : []),
    ...(usageResult.usageDelta > 20 ? ["usage_volatile"] : []),
  ];

  // 6. EV modifier (validated signals only)
  const evModifier = computeEVModifier({
    fatigueScore: fatigueResult.score,
    blowoutAdjustment: blowoutResult.evAdjustment,
    usageDelta: usageResult.usageDelta,
    aggressiveMode: false,
  });

  // 7. Volatility rating
  const volatilityRating = fatigueResult.score >= 60 || blowoutResult.probability >= 45
    ? "high"
    : fatigueResult.score >= 40 || blowoutResult.probability >= 25
    ? "elevated"
    : "stable";

  // 8. Human-readable summary
  const reasons: string[] = [];
  if (fatigueResult.score >= 50) reasons.push(fatigueResult.label);
  if (blowoutResult.probability >= 30) reasons.push(`${blowoutResult.probability}% blowout risk`);
  if (Math.abs(usageResult.usageDelta) >= 8) reasons.push(usageResult.label);
  if (matchupScore >= 70) reasons.push(matchupLabel);
  const whyItMoves = reasons.length > 0 ? reasons.join(". ") : "No significant contextual variance factors.";

  const signals = {
    fatigue: { ...fatigueResult, isBackToBack: fatigueRow?.isBackToBack ?? false, daysRest: fatigueRow?.daysRest ?? 2 },
    environment: { blowoutRisk: blowoutResult, envScore: envRow?.environmentScore ?? 50, spread, total },
    usage: usageResult,
    matchup: { score: matchupScore, label: matchupLabel, gamesPlayed: null },
    narrative: { score: 50, label: "No narrative signals" },
  };

  await db.insert(varianceScoresTable).values({
    ppLineId,
    playerId: player.id,
    statType: line.statType,
    fatigueScore: fatigueResult.score,
    environmentScore: Math.round(50 + (1 - blowoutResult.probability / 100) * 50),
    usageScore: usageResult.score,
    matchupScore,
    narrativeScore: 50,
    blowoutRisk: blowoutResult.probability,
    volatilityRating,
    ceilingRating: 50,
    floorRating: 50,
    evModifier: evModifier.toString(),
    signals,
    warnings,
    whyItMoves,
    computedAt: new Date(),
  }).onConflictDoUpdate({
    target: [varianceScoresTable.ppLineId],
    set: {
      fatigueScore: fatigueResult.score,
      environmentScore: Math.round(50 + (1 - blowoutResult.probability / 100) * 50),
      usageScore: usageResult.score,
      matchupScore,
      blowoutRisk: blowoutResult.probability,
      volatilityRating,
      evModifier: evModifier.toString(),
      signals,
      warnings,
      whyItMoves,
      computedAt: new Date(),
    },
  });
}

export async function computeAllVarianceScores(): Promise<number> {
  const lines = await db.select({ id: ppLinesTable.id }).from(ppLinesTable).where(eq(ppLinesTable.isActive, true));
  let computed = 0;
  for (const { id } of lines) {
    try {
      await computeVarianceForLine(id);
      computed++;
    } catch {
      // non-fatal — continue to next line
    }
  }
  return computed;
}
