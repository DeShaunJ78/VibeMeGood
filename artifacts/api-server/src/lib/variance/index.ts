import { db } from "@workspace/db";
import {
  ppLinesTable, playersTable, gamesTable,
  fatigueDataTable, varianceScoresTable,
  gameEnvironmentTable, matchupHistoryTable,
  playerGameLogsTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { computeFatigueScore, computeBlowoutRisk, computeUsageDelta, computeEVModifier } from "./compute-variance";

// In-memory version of computeUsageDelta — avoids a DB query per line in the batch run.
function computeUsageDeltaInMemory(
  rawLogs: { minutes: string | null; gameDate: string }[],
): { score: number; usageDelta: number; minutesTrend: "up" | "stable" | "down"; label: string } {
  const seen = new Set<string>();
  const uniqueLogs = rawLogs.filter(l => {
    if (seen.has(l.gameDate)) return false;
    seen.add(l.gameDate);
    return true;
  }).slice(0, 20);

  const logsWithMinutes = uniqueLogs.filter(l => l.minutes !== null);
  if (logsWithMinutes.length < 5) {
    return { score: 50, usageDelta: 0, minutesTrend: "stable", label: "Insufficient data" };
  }

  const recent5 = logsWithMinutes.slice(0, 5).map(l => parseFloat(l.minutes!.toString()));
  const season = logsWithMinutes.map(l => parseFloat(l.minutes!.toString()));
  const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
  const seasonAvg = season.reduce((a, b) => a + b, 0) / season.length;
  const delta = seasonAvg > 0 ? ((recentAvg - seasonAvg) / seasonAvg) * 100 : 0;

  let score = 50;
  let minutesTrend: "up" | "stable" | "down" = "stable";
  if (delta > 15) { score = 90; minutesTrend = "up"; }
  else if (delta > 8) { score = 72; minutesTrend = "up"; }
  else if (delta > 3) { score = 60; minutesTrend = "up"; }
  else if (delta < -15) { score = 15; minutesTrend = "down"; }
  else if (delta < -8) { score = 28; minutesTrend = "down"; }
  else if (delta < -3) { score = 40; minutesTrend = "down"; }

  const label = delta > 8 ? `+${delta.toFixed(0)}% usage spike — expanded role`
    : delta < -8 ? `${delta.toFixed(0)}% usage drop — reduced role`
    : "Usage stable";

  return { score, usageDelta: delta, minutesTrend, label };
}

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

  const [envRow] = game
    ? await db.select().from(gameEnvironmentTable).where(eq(gameEnvironmentTable.gameId, game.id))
    : [null];

  const spread = game?.spread ? Math.abs(parseFloat(game.spread.toString())) : 0;
  const total = envRow?.gameTotal
    ? parseFloat(envRow.gameTotal.toString())
    : game?.total ? parseFloat(game.total.toString()) : 0;

  const blowoutResult = computeBlowoutRisk(spread, total, player.sport);
  const usageResult = await computeUsageDelta(player.id, line.statType);

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

  const warnings = [
    ...fatigueResult.warnings,
    ...(blowoutResult.warning ? [blowoutResult.warning] : []),
    ...(usageResult.minutesTrend === "down" ? ["minutes_risk"] : []),
    ...(usageResult.usageDelta > 20 ? ["usage_volatile"] : []),
  ];

  const evModifier = computeEVModifier({
    fatigueScore: fatigueResult.score,
    blowoutAdjustment: blowoutResult.evAdjustment,
    usageDelta: usageResult.usageDelta,
    aggressiveMode: false,
  });

  const volatilityRating = fatigueResult.score >= 60 || blowoutResult.probability >= 45
    ? "high"
    : fatigueResult.score >= 40 || blowoutResult.probability >= 25
    ? "elevated"
    : "stable";

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

// Splits a large ID array into 1000-item chunks and runs the DB query for each
// chunk, concatenating results. Prevents Drizzle ORM's mergeQueries() from
// recursing too deep when building large IN (...) SQL clauses.
const IN_CHUNK = 200;
async function queryInChunks<T>(
  ids: number[],
  queryFn: (chunk: number[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  let out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    out = out.concat(await queryFn(ids.slice(i, i + IN_CHUNK)));
  }
  return out;
}

export async function computeAllVarianceScores(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];

  // 1. Load all active lines + players in one query.
  const rows = await db.select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  if (rows.length === 0) return 0;

  const playerIds = [...new Set(rows.map(r => r.player.id))];
  const gameIds = [...new Set(rows.filter(r => r.line.gameId != null).map(r => r.line.gameId as number))];

  // 2. Batch-load all supporting data.
  //    Game-keyed queries run in parallel (gameIds is always small).
  //    Player-keyed queries use queryInChunks to avoid Drizzle stack overflow
  //    when playerIds exceeds ~1000 after a full history backfill.
  const [games, gameEnvRows] = await Promise.all([
    gameIds.length
      ? db.select().from(gamesTable).where(inArray(gamesTable.id, gameIds))
      : Promise.resolve([] as (typeof gamesTable.$inferSelect)[]),
    gameIds.length
      ? db.select().from(gameEnvironmentTable).where(inArray(gameEnvironmentTable.gameId, gameIds))
      : Promise.resolve([] as (typeof gameEnvironmentTable.$inferSelect)[]),
  ]);
  const [fatigueRows, minLogs] = await Promise.all([
    queryInChunks(playerIds, chunk =>
      db.select().from(fatigueDataTable)
        .where(and(
          inArray(fatigueDataTable.playerId, chunk),
          eq(fatigueDataTable.computedForDate, today),
        ))
        .orderBy(desc(fatigueDataTable.computedAt))
    ),
    queryInChunks(playerIds, chunk =>
      db.select({
          playerId: playerGameLogsTable.playerId,
          minutes: playerGameLogsTable.minutes,
          gameDate: playerGameLogsTable.gameDate,
        })
        .from(playerGameLogsTable)
        .where(inArray(playerGameLogsTable.playerId, chunk))
        .orderBy(desc(playerGameLogsTable.gameDate))
    ),
  ]);

  // 3. Build lookup maps.
  const gameMap = new Map(games.map(g => [g.id, g]));

  const fatigueByPlayer = new Map<number, typeof fatigueDataTable.$inferSelect>();
  for (const f of fatigueRows) if (!fatigueByPlayer.has(f.playerId)) fatigueByPlayer.set(f.playerId, f);

  const envByGame = new Map(gameEnvRows.map(e => [e.gameId, e]));

  const minLogsByPlayer = new Map<number, { minutes: string | null; gameDate: string }[]>();
  for (const log of minLogs) {
    const arr = minLogsByPlayer.get(log.playerId) ?? [];
    if (arr.length < 40) arr.push({ minutes: log.minutes, gameDate: log.gameDate });
    minLogsByPlayer.set(log.playerId, arr);
  }

  // 4. Batch-load matchup history for all (player, opponent) combos.
  const opponentIdsByPlayer = new Map<number, Set<number>>();
  for (const { line, player } of rows) {
    if (!line.gameId || !player.teamId) continue;
    const game = gameMap.get(line.gameId);
    if (!game) continue;
    const oppId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
    if (oppId == null) continue;
    const s = opponentIdsByPlayer.get(player.id) ?? new Set<number>();
    s.add(oppId);
    opponentIdsByPlayer.set(player.id, s);
  }
  const allOpponentIds = [...new Set([...opponentIdsByPlayer.values()].flatMap(s => [...s]))];
  const matchupRows = allOpponentIds.length
    ? await queryInChunks(playerIds, chunk =>
        db.select().from(matchupHistoryTable)
          .where(and(
            inArray(matchupHistoryTable.playerId, chunk),
            inArray(matchupHistoryTable.opponentTeamId, allOpponentIds),
          ))
      )
    : [] as (typeof matchupHistoryTable.$inferSelect)[];

  const matchupByKey = new Map<string, typeof matchupHistoryTable.$inferSelect>();
  for (const m of matchupRows) {
    matchupByKey.set(`${m.playerId}:${m.opponentTeamId}:${m.statType}`, m);
  }

  // 5. Process all lines in-memory and collect insert payloads.
  let computed = 0;
  const insertPayloads: (typeof varianceScoresTable.$inferInsert)[] = [];

  for (const { line, player } of rows) {
    try {
      const game = line.gameId ? gameMap.get(line.gameId) ?? null : null;

      const fatigueRow = fatigueByPlayer.get(player.id) ?? null;
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

      const envRow = game ? envByGame.get(game.id) ?? null : null;
      const spread = game?.spread ? Math.abs(parseFloat(game.spread.toString())) : 0;
      const total = envRow?.gameTotal
        ? parseFloat(envRow.gameTotal.toString())
        : game?.total ? parseFloat(game.total.toString()) : 0;
      const blowoutResult = computeBlowoutRisk(spread, total, player.sport);

      const usageResult = computeUsageDeltaInMemory(minLogsByPlayer.get(player.id) ?? []);

      let matchupScore = 50;
      let matchupLabel = "No historical matchup data";
      if (game && player.teamId) {
        const oppTeamId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
        const matchup = matchupByKey.get(`${player.id}:${oppTeamId}:${line.statType}`);
        if (matchup && matchup.gamesPlayed && matchup.gamesPlayed >= 3) {
          const overRate = matchup.overRateAtCurrentLine ? parseFloat(matchup.overRateAtCurrentLine.toString()) : 0.5;
          matchupScore = Math.round(overRate * 100);
          matchupLabel = `${matchup.gamesPlayed} games vs this opponent — ${Math.round(overRate * 100)}% over rate`;
        }
      }

      const warnings = [
        ...fatigueResult.warnings,
        ...(blowoutResult.warning ? [blowoutResult.warning] : []),
        ...(usageResult.minutesTrend === "down" ? ["minutes_risk"] : []),
        ...(usageResult.usageDelta > 20 ? ["usage_volatile"] : []),
      ];

      const evModifier = computeEVModifier({
        fatigueScore: fatigueResult.score,
        blowoutAdjustment: blowoutResult.evAdjustment,
        usageDelta: usageResult.usageDelta,
        aggressiveMode: false,
      });

      const volatilityRating = fatigueResult.score >= 60 || blowoutResult.probability >= 45
        ? "high"
        : fatigueResult.score >= 40 || blowoutResult.probability >= 25
        ? "elevated"
        : "stable";

      const reasons: string[] = [];
      if (fatigueResult.score >= 50) reasons.push(fatigueResult.label);
      if (blowoutResult.probability >= 30) reasons.push(`${blowoutResult.probability}% blowout risk`);
      if (Math.abs(usageResult.usageDelta) >= 8) reasons.push(usageResult.label);
      if (matchupScore >= 70) reasons.push(matchupLabel);
      const whyItMoves = reasons.length > 0 ? reasons.join(". ") : "No significant contextual variance factors.";

      insertPayloads.push({
        ppLineId: line.id,
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
        signals: {
          fatigue: { ...fatigueResult, isBackToBack: fatigueRow?.isBackToBack ?? false, daysRest: fatigueRow?.daysRest ?? 2 },
          environment: { blowoutRisk: blowoutResult, envScore: envRow?.environmentScore ?? 50, spread, total },
          usage: usageResult,
          matchup: { score: matchupScore, label: matchupLabel, gamesPlayed: null },
          narrative: { score: 50, label: "No narrative signals" },
        },
        warnings,
        whyItMoves,
        computedAt: new Date(),
      });

      computed++;
    } catch {
      // non-fatal — skip this line
    }
  }

  // 6. Bulk upsert variance scores in chunked batches (same Drizzle stack-depth
  //    guard as compute.ts — single large INSERT overflows mergeQueries recursion).
  const VAR_CHUNK = 500;
  for (let i = 0; i < insertPayloads.length; i += VAR_CHUNK) {
    await db.insert(varianceScoresTable).values(insertPayloads.slice(i, i + VAR_CHUNK))
      .onConflictDoUpdate({
        target: [varianceScoresTable.ppLineId],
        set: {
          fatigueScore:      sql`excluded.fatigue_score`,
          environmentScore:  sql`excluded.environment_score`,
          usageScore:        sql`excluded.usage_score`,
          matchupScore:      sql`excluded.matchup_score`,
          blowoutRisk:       sql`excluded.blowout_risk`,
          volatilityRating:  sql`excluded.volatility_rating`,
          evModifier:        sql`excluded.ev_modifier`,
          signals:           sql`excluded.signals`,
          warnings:          sql`excluded.warnings`,
          whyItMoves:        sql`excluded.why_it_moves`,
          computedAt:        sql`excluded.computed_at`,
        },
      });
  }

  return computed;
}
