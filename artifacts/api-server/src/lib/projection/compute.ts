import { db } from "@workspace/db";
import {
  playerGameLogsTable, ourProjectionsTable, ppLinesTable, playersTable,
  injuriesTable, matchupHistoryTable, gamesTable, teamsTable,
  fatigueDataTable, teamPaceRatingsTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { getNflUsageMap } from "../sync/nfl-advanced";
import { getPaceAdjustment, NBA_2025_SEED_PACE } from "../analytics/pace";
import { volatilityPct } from "./normal-dist";
import { pOverLineDist, percentileAtLineDist, getDistributionFamily, type DistributionFamily } from "./distributions";
import {
  getPrior, minGamesForConfidence,
  MIN_GAMES_FOR_PLAY, SHRINKAGE_K, DQ_PLAY_THRESHOLD,
  PROJECTION_TTL_HOURS, LINE_TYPE_STD_ADJ,
} from "./priors";
import { calibratePOver, loadCalibrationMap, type CalibrationMap } from "./calibration";
import {
  restFactor, paceFactor, dvpFactor, impliedTotalFactor, weatherFactor,
  nflAdvancedFactor, snapFactor, parkFactor, combineFactors,
  impliedTeamTotal, SPORT_IMPLIED_BASELINE,
  type FactorResult,
} from "./factors";
import { logger } from "../logger";

export interface ProjectionOutput {
  mean: number;
  stdDev: number;
  p99: number | null;       // mean + 2.33σ — 99th percentile ceiling (null when prior_only)
  pOver: number;            // 0–100 (calibrated when a calibration map is supplied)
  pOverRaw: number;         // 0–100 raw P(over), pre-calibration (Poisson or normal CDF)
  distributionFamily: DistributionFamily; // "poisson" for sparse counting stats, "normal" otherwise
  percentileAtLine: number; // 0–100, where line sits in distribution
  dataQualityScore: number; // 0–100 gate score
  shrinkageFactor: number;  // 0=no shrinkage, 1=full prior
  gamesUsed: number;
  sourceLabel: string;
  noPlayReason: string | null;
  opponentAdj: number;
  volatilityPct: number;    // σ/line * 100 — how wide the band is
  ensembleBlendPct: number;      // calibration blend weight % (empirical rate weight)
  calSampleSize: number;         // settled results behind the calibration bucket used
  vor: number | null;            // Value Over Replacement = (mean − line) / σ (Addition 13)
  expiresAt: Date;
  // Explanation breakdowns for the UI
  reasoning: {
    sampleSize: string;
    shrinkageExplain: string;
    opponentExplain: string;
    lineTypeExplain: string;
    calibrationExplain: string;
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
  calibrationMap?: CalibrationMap | null,
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

  let rawValues = logs.map(l => parseFloat(l.value.toString()));

  // --- Combo stat fallback: compute from individual component logs ---
  const COMBO_MAP: Record<string, string[]> = {
    "Pts+Rebs+Asts": ["Points", "Rebounds", "Assists"],
    "Pts+Rebs":      ["Points", "Rebounds"],
    "Pts+Asts":      ["Points", "Assists"],
    "Rebs+Asts":     ["Rebounds", "Assists"],
  };
  const comboComponents = COMBO_MAP[statType] ?? null;

  if (rawValues.length === 0 && comboComponents) {
    const componentLogs = await db
      .select({
        gameDate: playerGameLogsTable.gameDate,
        statType: playerGameLogsTable.statType,
        value:    playerGameLogsTable.value,
      })
      .from(playerGameLogsTable)
      .where(and(
        eq(playerGameLogsTable.playerId, playerId),
        inArray(playerGameLogsTable.statType, comboComponents),
      ))
      .orderBy(desc(playerGameLogsTable.gameDate))
      .limit(60);

    // Sum all components per game date
    const byDate = new Map<string, number>();
    for (const log of componentLogs) {
      const d = log.gameDate ?? "";
      byDate.set(d, (byDate.get(d) ?? 0) + parseFloat(log.value.toString()));
    }

    // Only keep dates where ALL components are present
    const completeDates = new Map<string, number>();
    for (const [date, total] of byDate) {
      const compsForDate = componentLogs.filter(l => l.gameDate === date);
      const uniqueStats = new Set(compsForDate.map(l => l.statType));
      if (uniqueStats.size === comboComponents.length) {
        completeDates.set(date, total);
      }
    }

    const comboValues = Array.from(completeDates.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 20)
      .map(([, v]) => v);

    if (comboValues.length > 0) {
      rawValues = comboValues;
    }
  }

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

  // --- 2b. Probability calibration is applied AFTER P(over) is computed (see step 9).
  //         We blend the raw P(over) toward the empirical bucket hit rate rather than
  //         nudging the mean, which keeps the calibration self-consistent and avoids
  //         edge-bucket drift. Declared here so they're in scope for the return. ---
  let ensembleBlendPct = 0; // repurposed: empirical-rate blend weight %
  let calSampleSize = 0;    // settled results behind the bucket used
  let calibrationExplain = "";

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
  // Route to Poisson CDF for sparse counting stats (Home Runs, Goals, TDs, etc.)
  // All other stats continue to use the normal CDF.
  const distFamily = getDistributionFamily(statType);
  const pOverRaw = pOverLineDist(mean, effectiveStd, ppLine, statType);
  const pctAtLine = percentileAtLineDist(mean, effectiveStd, ppLine, statType);
  const volPct = volatilityPct(effectiveStd, ppLine);

  // --- 7b. Probability calibration: blend raw P(over) toward the empirical bucket
  //         hit rate (only when a calibration map is supplied — the calibration job
  //         passes none so it always sees raw P(over) and stays self-consistent). ---
  let pOver = pOverRaw;
  if (sourceLabel !== "prior_only") {
    const cal = calibratePOver(pOverRaw, sport, statType, lineType, calibrationMap);
    pOver = cal.pOver;
    ensembleBlendPct = cal.weightPct;
    calSampleSize = cal.sampleSize;
    if (cal.explain) calibrationExplain = cal.explain;
  }
  // Fix 10: p99 ceiling is meaningless for prior-only projections (no real game data).
  const p99 = sourceLabel === "prior_only" ? null : Math.round((mean + 2.33 * effectiveStd) * 100) / 100;

  // --- 7b. Value Over Replacement (Addition 13) ---
  const vor = effectiveStd > 0 ? Math.round(((mean - ppLine) / effectiveStd) * 1000) / 1000 : null;

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
    pOverRaw: Math.round(pOverRaw * 10) / 10,
    distributionFamily: distFamily,
    percentileAtLine: Math.round(pctAtLine * 10) / 10,
    dataQualityScore: finalDQ,
    shrinkageFactor: Math.round(shrinkageFactor * 1000) / 1000,
    gamesUsed: n,
    sourceLabel,
    noPlayReason,
    opponentAdj: Math.round(opponentAdj * 1000) / 1000,
    volatilityPct: Math.round(volPct * 10) / 10,
    ensembleBlendPct,
    calSampleSize,
    vor,
    expiresAt: new Date(Date.now() + PROJECTION_TTL_HOURS * 60 * 60 * 1000),
    reasoning: {
      sampleSize: n < MIN_GAMES_FOR_PLAY
        ? `${n} games — below minimum (${MIN_GAMES_FOR_PLAY})`
        : `${n} games used (decay-weighted)`,
      shrinkageExplain,
      opponentExplain,
      lineTypeExplain,
      calibrationExplain: calibrationExplain || "No calibration applied (insufficient settled results for this bucket)",
      qualityDeductions: deductions,
    },
  };
}

const MLB_PARK_FACTORS: Record<string, number> = {
  COL: 1.18, CIN: 1.12, BOS: 1.08, PHI: 1.06, TEX: 1.05,
  NYY: 1.03, TOR: 0.97, MIA: 0.95, OAK: 0.94, PIT: 0.93,
  NYM: 0.92, TB: 0.92, SF: 0.90, SD: 0.88, SEA: 0.88,
};
const MLB_BATTING_STATS = ["hits", "home runs", "total bases", "rbis", "runs", "doubles", "triples"];

interface WeatherMeta { isOutdoor?: boolean; windSpeed?: number; temp?: number }

export async function computeAllProjections(): Promise<number> {
  const activeLines = await db
    .select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  const playerIds = [...new Set(activeLines.map(r => r.line.playerId))];

  // --- Pre-fetch games (spread/total/weather live here) ---
  const gameIds = [...new Set(
    activeLines.filter(r => r.line.gameId).map(r => r.line.gameId as number),
  )];
  const games = gameIds.length
    ? await db.select().from(gamesTable).where(inArray(gamesTable.id, gameIds))
    : [];
  const gameMap = Object.fromEntries(games.map(g => [g.id, g]));

  // --- Team abbreviations for ALL teams in play (home + away) — pace + park ---
  const teamIds = [...new Set(games.flatMap(g => [g.homeTeamId, g.awayTeamId]))];
  const teams = teamIds.length
    ? await db.select({ id: teamsTable.id, abbreviation: teamsTable.abbreviation })
        .from(teamsTable)
        .where(inArray(teamsTable.id, teamIds))
    : [];
  const teamAbbrMap = new Map(teams.map(t => [t.id, t.abbreviation]));

  // --- Batch-load all factor context in parallel ---
  const [fatigueRows, paceRows, nflUsageMap, dvpRows] = await Promise.all([
    // Latest fatigue row per player (ordered desc; we keep the first seen).
    playerIds.length
      ? db.select().from(fatigueDataTable)
          .where(inArray(fatigueDataTable.playerId, playerIds))
          .orderBy(desc(fatigueDataTable.computedForDate))
      : Promise.resolve([] as (typeof fatigueDataTable.$inferSelect)[]),
    // NBA team pace ratings.
    db.select().from(teamPaceRatingsTable).where(eq(teamPaceRatingsTable.sport, "NBA"))
      .orderBy(desc(teamPaceRatingsTable.season)),
    // NFL advanced usage (target share / WOPR / snap) keyed by player name.
    getNflUsageMap(activeLines.filter(r => r.player.sport === "NFL").map(r => r.player.fullName)),
    // Defense-vs-position: opponent-allowed averages by (team, position, stat).
    db.select({
        opponentTeamId: playerGameLogsTable.opponentTeamId,
        sport: playersTable.sport,
        position: playersTable.position,
        statType: playerGameLogsTable.statType,
        avgValue: sql<string>`avg(${playerGameLogsTable.value})`,
        games: sql<string>`count(*)`,
      })
      .from(playerGameLogsTable)
      .innerJoin(playersTable, eq(playersTable.id, playerGameLogsTable.playerId))
      .where(and(isNotNull(playerGameLogsTable.opponentTeamId), isNotNull(playersTable.position)))
      .groupBy(playerGameLogsTable.opponentTeamId, playersTable.sport, playersTable.position, playerGameLogsTable.statType),
  ]);

  // Index fatigue (first row per player = latest).
  const fatigueByPlayer = new Map<number, typeof fatigueDataTable.$inferSelect>();
  for (const f of fatigueRows) if (!fatigueByPlayer.has(f.playerId)) fatigueByPlayer.set(f.playerId, f);

  // Index NBA pace by abbreviation (first = most recent season), fall back to seed.
  const paceByAbbr = new Map<string, number>();
  for (const p of paceRows) {
    if (!paceByAbbr.has(p.teamAbbr)) paceByAbbr.set(p.teamAbbr, parseFloat(p.paceRating.toString()));
  }
  const teamPace = (abbr: string | undefined): number | null => {
    if (!abbr) return null;
    return paceByAbbr.get(abbr) ?? NBA_2025_SEED_PACE[abbr.toUpperCase()] ?? null;
  };

  // Index DvP: team-allowed map + league baseline (count-weighted).
  const dvpByTeam = new Map<string, { avg: number; games: number }>();
  const leagueAgg = new Map<string, { sum: number; cnt: number }>();
  for (const r of dvpRows) {
    if (r.opponentTeamId == null || !r.position) continue;
    const avg = parseFloat(r.avgValue);
    const games = parseInt(r.games, 10);
    dvpByTeam.set(`${r.opponentTeamId}:${r.sport}:${r.position}:${r.statType}`, { avg, games });
    const lk = `${r.sport}:${r.position}:${r.statType}`;
    const cur = leagueAgg.get(lk) ?? { sum: 0, cnt: 0 };
    cur.sum += avg * games;
    cur.cnt += games;
    leagueAgg.set(lk, cur);
  }

  // Load the calibration table once and reuse it for every projection this run.
  const calibrationMap = await loadCalibrationMap();

  let computed = 0;

  for (const { line, player } of activeLines) {
    const sport = player.sport.toUpperCase();
    const game = line.gameId ? gameMap[line.gameId] : null;

    // Resolve opponent + home/away from game context.
    let opponentTeamId: number | null = null;
    let isHome: boolean | null = null;
    if (game && player.teamId) {
      opponentTeamId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
      isHome = game.homeTeamId === player.teamId;
    }

    try {
      const result = await computeProjection(
        line.playerId,
        line.statType,
        parseFloat(line.lineValue.toString()),
        line.lineType,
        player.sport,
        opponentTeamId,
        calibrationMap,
      );

      // ── Build the factor stack ──────────────────────────────────────────
      const factors: (FactorResult | null)[] = [];

      // Rest / fatigue
      const fat = fatigueByPlayer.get(line.playerId);
      if (fat) {
        factors.push(restFactor({
          isBackToBack: fat.isBackToBack,
          isThreeInFour: fat.isThreeInFour,
          daysRest: fat.daysRest,
          fatigueScore: fat.fatigueScore,
        }));
      }

      // Pace (NBA/WNBA)
      if ((sport === "NBA" || sport === "WNBA") && game) {
        const hp = teamPace(teamAbbrMap.get(game.homeTeamId));
        const ap = teamPace(teamAbbrMap.get(game.awayTeamId));
        if (hp != null && ap != null) {
          const gamePace = (hp + ap) / 2;
          factors.push(paceFactor(getPaceAdjustment(gamePace), gamePace, line.statType));
        }
      }

      // Defense vs position
      if (opponentTeamId != null && player.position) {
        const tk = `${opponentTeamId}:${player.sport}:${player.position}:${line.statType}`;
        const lk = `${player.sport}:${player.position}:${line.statType}`;
        const allowed = dvpByTeam.get(tk);
        const lg = leagueAgg.get(lk);
        const leagueAvg = lg && lg.cnt > 0 ? lg.sum / lg.cnt : null;
        factors.push(dvpFactor({
          teamAllowed: allowed?.avg ?? null,
          leagueAvg,
          games: allowed?.games ?? null,
        }));
      }

      // Implied team total — requires a known home/away side; never assume one
      // (assuming home when the side is unknown would fabricate a signal).
      if (game && isHome != null) {
        const total = game.total != null ? parseFloat(game.total.toString()) : null;
        const spread = game.spread != null ? parseFloat(game.spread.toString()) : null;
        const implied = impliedTeamTotal(total, spread, isHome);
        factors.push(impliedTotalFactor(implied, SPORT_IMPLIED_BASELINE[sport] ?? null, line.statType));
      }

      // Weather (outdoor NFL)
      if (game?.metadata) {
        const w = (game.metadata as { weather?: WeatherMeta }).weather;
        if (w) {
          factors.push(weatherFactor({
            isOutdoor: w.isOutdoor,
            windSpeed: w.windSpeed,
            temp: w.temp,
            statType: line.statType,
          }));
        }
      }

      // NFL advanced usage + snap
      if (sport === "NFL") {
        const usage = nflUsageMap.get(player.fullName.toLowerCase());
        if (usage) {
          factors.push(nflAdvancedFactor({
            targetShare: usage.targetShare,
            wopr: usage.wopr,
            statType: line.statType,
          }));
          factors.push(snapFactor(usage.snapPct));
        }
      }

      // MLB park
      if (sport === "MLB" && game) {
        const homeAbbr = teamAbbrMap.get(game.homeTeamId);
        const isBatter = MLB_BATTING_STATS.some(s => line.statType.toLowerCase().includes(s));
        if (homeAbbr && isBatter) {
          factors.push(parkFactor(MLB_PARK_FACTORS[homeAbbr.toUpperCase()] ?? null, homeAbbr));
        }
      }

      const { combinedFactor, applied } = combineFactors(factors);
      const adjustedMean = Math.round(result.mean * combinedFactor * 100) / 100;

      const factorVal = (key: string): string =>
        (applied.find(f => f.key === key)?.factor ?? 1).toString();

      const payload = {
        playerId: line.playerId,
        statType: line.statType,
        gameId: line.gameId ?? null,
        projectedValue: adjustedMean.toString(),
        weightedAvg: result.mean.toString(),
        gamesUsed: result.gamesUsed,
        confidence: result.pOver >= 60 && result.dataQualityScore >= 70 ? "high"
          : result.pOver >= 52 && result.dataQualityScore >= 50 ? "medium"
          : "low",
        modelVersion: "v3",
        stdDev: result.stdDev.toString(),
        p99: result.p99 != null ? result.p99.toString() : null,
        pOver: result.pOver.toString(),
        percentileAtLine: result.percentileAtLine.toString(),
        dataQualityScore: result.dataQualityScore,
        shrinkageFactor: result.shrinkageFactor.toString(),
        noPlayReason: result.noPlayReason,
        sourceLabel: result.sourceLabel,
        opponentAdj: result.opponentAdj.toString(),
        paceFactor: factorVal("pace"),
        defenseFactor: factorVal("dvp"),
        restFactor: factorVal("rest"),
        adjustments: applied,
        ensembleBlendPct: result.ensembleBlendPct,
        vor: result.vor != null ? result.vor.toString() : null,
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
