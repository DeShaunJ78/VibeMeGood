import { db } from "@workspace/db";
import {
  playerGameLogsTable, ourProjectionsTable, ppLinesTable, playersTable,
  injuriesTable, matchupHistoryTable, gamesTable, teamsTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getSnapPctAdjustment } from "../sync/nfl-advanced";
import { pOverLine, percentileAtLine, volatilityPct } from "./normal-dist";
import {
  getPrior, minGamesForConfidence,
  MIN_GAMES_FOR_PLAY, SHRINKAGE_K, DQ_PLAY_THRESHOLD,
  PROJECTION_TTL_HOURS, LINE_TYPE_STD_ADJ,
} from "./priors";
import { logger } from "../logger";

export interface ProjectionOutput {
  mean: number;
  stdDev: number;
  p99: number | null;       // mean + 2.33σ — 99th percentile ceiling (null when prior_only)
  pOver: number;            // 0–100
  percentileAtLine: number; // 0–100, where line sits in distribution
  dataQualityScore: number; // 0–100 gate score
  shrinkageFactor: number;  // 0=no shrinkage, 1=full prior
  gamesUsed: number;
  sourceLabel: string;
  noPlayReason: string | null;
  opponentAdj: number;
  volatilityPct: number;    // σ/line * 100 — how wide the band is
  expiresAt: Date;
  // Explanation breakdowns for the UI
  reasoning: {
    sampleSize: string;
    shrinkageExplain: string;
    opponentExplain: string;
    lineTypeExplain: string;
    qualityDeductions: string[];
  };
}

export async function computeProjection(
  playerId: number,
  statType: string,
  ppLine: number,
  lineType: string,
  sport: string,
  opponentTeamId?: number | null,
): Promise<ProjectionOutput> {
  const prior = getPrior(sport, statType);
  const deductions: string[] = [];

  // --- 1. Fetch game logs (last 20, use up to 15) ---
  const logs = await db
    .select()
    .from(playerGameLogsTable)
    .where(and(
      eq(playerGameLogsTable.playerId, playerId),
      eq(playerGameLogsTable.statType, statType),
    ))
    .orderBy(desc(playerGameLogsTable.gameDate))
    .limit(20);

  const rawValues = logs.map(l => parseFloat(l.value.toString()));
  const n = Math.min(rawValues.length, 15);
  const usedValues = rawValues.slice(0, n);

  let dataQualityScore = 100;
  let noPlayReason: string | null = null;
  let mean: number;
  let stdDev: number;
  let shrinkageFactor: number;
  let sourceLabel: string;

  // --- 2. Compute distribution (or fall back to prior) ---
  if (n < MIN_GAMES_FOR_PLAY) {
    mean = prior.mean;
    stdDev = prior.std;
    shrinkageFactor = 1.0;
    sourceLabel = "prior_only";
    dataQualityScore = 25;
    noPlayReason = "insufficient_data";
    deductions.push(`Only ${n} game log${n === 1 ? "" : "s"} — minimum is ${MIN_GAMES_FOR_PLAY}`);
  } else {
    // Exponential-decay weighted mean (more recent = more weight)
    const decay = 0.12;
    const weights = usedValues.map((_, i) => Math.exp(-i * decay));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const weightedMean = usedValues.reduce((s, v, i) => s + v * weights[i], 0) / totalWeight;

    // Sample std dev (unweighted for stability)
    const simpleMean = usedValues.reduce((a, b) => a + b, 0) / n;
    const variance = usedValues.reduce((s, v) => s + (v - simpleMean) ** 2, 0) / Math.max(n - 1, 1);
    const sampleStd = Math.sqrt(variance);

    // Bayesian shrinkage toward the population prior
    shrinkageFactor = SHRINKAGE_K / (n + SHRINKAGE_K);
    mean = (1 - shrinkageFactor) * weightedMean + shrinkageFactor * prior.mean;
    // Blend std devs — never let variance collapse below 40% of prior
    stdDev = Math.max(
      (1 - shrinkageFactor) * sampleStd + shrinkageFactor * prior.std,
      prior.std * 0.4,
    );

    sourceLabel = `weighted_avg_n${n}`;

    // Sample size deductions
    const minFull = minGamesForConfidence(sport);
    if (n < 6) {
      dataQualityScore -= 20;
      deductions.push(`Low sample (${n} games)`);
    } else if (n < minFull) {
      dataQualityScore -= 10;
      deductions.push(`Partial sample (${n}/${minFull} games)`);
    }
  }

  // --- 3. Opponent adjustment ---
  let opponentAdj = 1.0;
  let opponentExplain = "No matchup data — neutral adjustment";

  if (opponentTeamId) {
    try {
      const [matchup] = await db
        .select()
        .from(matchupHistoryTable)
        .where(and(
          eq(matchupHistoryTable.playerId, playerId),
          eq(matchupHistoryTable.opponentTeamId, opponentTeamId),
          eq(matchupHistoryTable.statType, statType),
        ))
        .limit(1);

      if (matchup?.avgValue && matchup.gamesPlayed && matchup.gamesPlayed >= 3) {
        const histAvg = parseFloat(matchup.avgValue.toString());
        // Blend 30% matchup signal into mean (don't over-weight)
        const rawAdj = histAvg / Math.max(mean, 0.1);
        opponentAdj = 0.7 * 1.0 + 0.3 * rawAdj; // 70% neutral, 30% matchup
        opponentExplain = `${matchup.gamesPlayed}g vs opponent avg ${histAvg.toFixed(1)} → ×${opponentAdj.toFixed(3)}`;
      } else {
        dataQualityScore -= 10;
        deductions.push("No opponent matchup history");
        opponentExplain = "No matchup history vs this opponent";
      }
    } catch {
      dataQualityScore -= 10;
    }
  } else {
    dataQualityScore -= 10;
    deductions.push("No opponent context");
  }

  mean = mean * opponentAdj;

  // --- 4. Injury check ---
  let injuryExplain = "";
  try {
    const [injury] = await db
      .select()
      .from(injuriesTable)
      .where(eq(injuriesTable.playerId, playerId))
      .orderBy(desc(injuriesTable.reportedAt))
      .limit(1);

    if (injury) {
      const status = (injury.status || "").toLowerCase();
      if (status === "out") {
        dataQualityScore -= 60;
        noPlayReason = "player_out";
        injuryExplain = "Player listed OUT";
        deductions.push("Player OUT — projection unreliable");
      } else if (status === "gtd") {
        dataQualityScore -= 30;
        if (!noPlayReason) noPlayReason = "game_time_decision";
        injuryExplain = "Game-time decision";
        deductions.push("GTD — play eligibility uncertain");
      } else if (status === "questionable") {
        dataQualityScore -= 15;
        injuryExplain = "Questionable — reduced confidence";
        deductions.push("Questionable injury status");
      }
    }
  } catch { /* non-fatal */ }

  // --- 5. Final DQ gate ---
  if (!noPlayReason && dataQualityScore < DQ_PLAY_THRESHOLD) {
    noPlayReason = "low_data_quality";
    deductions.push(`DQ score ${dataQualityScore} below threshold ${DQ_PLAY_THRESHOLD}`);
  }

  // --- 6. Apply line-type std adjustment ---
  const stdAdj = LINE_TYPE_STD_ADJ[lineType] ?? 1.0;
  const effectiveStd = stdDev * stdAdj;

  // --- 7. Compute distribution outputs ---
  const pOver = pOverLine(mean, effectiveStd, ppLine);
  const pctAtLine = percentileAtLine(mean, effectiveStd, ppLine);
  const volPct = volatilityPct(effectiveStd, ppLine);
  // Fix 10: p99 ceiling is meaningless for prior-only projections (no real game data).
  const p99 = sourceLabel === "prior_only" ? null : Math.round((mean + 2.33 * effectiveStd) * 100) / 100;

  // --- 8. Confidence label ---
  const finalDQ = Math.max(0, Math.min(100, dataQualityScore));
  const confidence =
    finalDQ >= 80 && n >= 10 ? "high" :
    finalDQ >= 60 && n >= MIN_GAMES_FOR_PLAY ? "medium" :
    "low";

  // --- 9. Shrinkage explanation ---
  const shrinkPct = Math.round(shrinkageFactor * 100);
  const shrinkageExplain =
    shrinkageFactor >= 0.99
      ? "Full prior — no game log data"
      : shrinkPct > 40
        ? `${shrinkPct}% toward prior (small sample)`
        : shrinkPct > 15
          ? `${shrinkPct}% toward prior (moderate sample)`
          : `${shrinkPct}% shrinkage (large sample)`;

  // Line type explanation
  const lineTypeExplain =
    lineType === "goblin" ? `Goblin line — set ${Math.round((1 - stdAdj) * 100 + (stdAdj - 1) * 100)}% wider std, naturally easier to beat`
    : lineType === "demon" ? "Demon line — set artificially high, lower P(over) expected"
    : "Standard line";

  return {
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(effectiveStd * 100) / 100,
    p99,
    pOver: Math.round(pOver * 10) / 10,
    percentileAtLine: Math.round(pctAtLine * 10) / 10,
    dataQualityScore: finalDQ,
    shrinkageFactor: Math.round(shrinkageFactor * 1000) / 1000,
    gamesUsed: n,
    sourceLabel,
    noPlayReason,
    opponentAdj: Math.round(opponentAdj * 1000) / 1000,
    volatilityPct: Math.round(volPct * 10) / 10,
    expiresAt: new Date(Date.now() + PROJECTION_TTL_HOURS * 60 * 60 * 1000),
    reasoning: {
      sampleSize: n < MIN_GAMES_FOR_PLAY
        ? `${n} games — below minimum (${MIN_GAMES_FOR_PLAY})`
        : `${n} games used (decay-weighted)`,
      shrinkageExplain,
      opponentExplain,
      lineTypeExplain,
      qualityDeductions: deductions,
    },
  };
}

export async function computeAllProjections(): Promise<number> {
  const activeLines = await db
    .select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  // Pre-fetch games for opponent team ID lookup
  const gameIds = [...new Set(
    activeLines.filter(r => r.line.gameId).map(r => r.line.gameId as number),
  )];
  const games = gameIds.length
    ? await db.select().from(gamesTable).where(inArray(gamesTable.id, gameIds))
    : [];
  const gameMap = Object.fromEntries(games.map(g => [g.id, g]));

  // Pre-fetch home team abbreviations for MLB park factor
  const homeTeamIds = [...new Set(games.map(g => g.homeTeamId))];
  const homeTeams = homeTeamIds.length
    ? await db.select({ id: teamsTable.id, abbreviation: teamsTable.abbreviation })
        .from(teamsTable)
        .where(inArray(teamsTable.id, homeTeamIds))
    : [];
  const teamAbbrMap = new Map(homeTeams.map(t => [t.id, t.abbreviation]));

  const MLB_PARK_FACTORS: Record<string, number> = {
    COL: 1.18, CIN: 1.12, BOS: 1.08, PHI: 1.06, TEX: 1.05,
    NYY: 1.03, TOR: 0.97, MIA: 0.95, OAK: 0.94, PIT: 0.93,
    NYM: 0.92, TB: 0.92, SF: 0.90, SD: 0.88, SEA: 0.88,
  };
  const MLB_BATTING_STATS = ["hits", "home runs", "total bases", "rbis", "runs", "doubles", "triples"];

  let computed = 0;

  for (const { line, player } of activeLines) {
    // Resolve opponent from game context
    let opponentTeamId: number | null = null;
    if (line.gameId && gameMap[line.gameId] && player.teamId) {
      const g = gameMap[line.gameId];
      opponentTeamId = g.homeTeamId === player.teamId ? g.awayTeamId : g.homeTeamId;
    }

    try {
      const result = await computeProjection(
        line.playerId,
        line.statType,
        parseFloat(line.lineValue.toString()),
        line.lineType,
        player.sport,
        opponentTeamId,
      );

      // Apply snap% adjustment for NFL players
      let adjustedMean = result.mean;
      if (player.sport.toUpperCase() === "NFL") {
        const snapAdj = await getSnapPctAdjustment(player.fullName);
        adjustedMean = Math.round(result.mean * snapAdj * 100) / 100;
      }

      // Apply MLB park factor for batting stats
      if (player.sport.toUpperCase() === "MLB" && line.gameId && gameMap[line.gameId]) {
        const game = gameMap[line.gameId];
        const homeTeamAbbr = teamAbbrMap.get(game.homeTeamId);
        if (homeTeamAbbr) {
          const isBatter = MLB_BATTING_STATS.some(s => line.statType.toLowerCase().includes(s));
          if (isBatter) {
            const factor = MLB_PARK_FACTORS[homeTeamAbbr.toUpperCase()] ?? 1.0;
            adjustedMean = Math.round(adjustedMean * factor * 100) / 100;
          }
        }
      }

      const payload = {
        playerId: line.playerId,
        statType: line.statType,
        projectedValue: adjustedMean.toString(),
        weightedAvg: result.mean.toString(),
        gamesUsed: result.gamesUsed,
        confidence: result.pOver >= 60 && result.dataQualityScore >= 70 ? "high"
          : result.pOver >= 52 && result.dataQualityScore >= 50 ? "medium"
          : "low",
        modelVersion: "v2",
        stdDev: result.stdDev.toString(),
        p99: result.p99 != null ? result.p99.toString() : null,
        pOver: result.pOver.toString(),
        percentileAtLine: result.percentileAtLine.toString(),
        dataQualityScore: result.dataQualityScore,
        shrinkageFactor: result.shrinkageFactor.toString(),
        noPlayReason: result.noPlayReason,
        sourceLabel: result.sourceLabel,
        opponentAdj: result.opponentAdj.toString(),
        expiresAt: result.expiresAt,
        generatedAt: new Date(),
      };

      const [existing] = await db
        .select()
        .from(ourProjectionsTable)
        .where(and(
          eq(ourProjectionsTable.playerId, line.playerId),
          eq(ourProjectionsTable.statType, line.statType),
        ))
        .limit(1);

      if (existing) {
        await db.update(ourProjectionsTable).set(payload).where(eq(ourProjectionsTable.id, existing.id));
      } else {
        await db.insert(ourProjectionsTable).values(payload);
      }

      computed++;
    } catch (e) {
      logger.error({ err: e, lineId: line.id }, "Projection compute error");
    }
  }

  logger.info({ computed }, "computeAllProjections done");
  return computed;
}
