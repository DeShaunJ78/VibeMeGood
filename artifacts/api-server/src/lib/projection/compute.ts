import { db } from "@workspace/db";
import {
  playerGameLogsTable, ourProjectionsTable, ppLinesTable, playersTable,
  injuriesTable, matchupHistoryTable, gamesTable, teamsTable,
  fatigueDataTable, teamPaceRatingsTable, lineupConfirmationsTable,
  pitcherProfilesTable, nhlPlayerContextTable,
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
  minutesFactor, usageRateFactor, threePointDefenseFactor,
  redZoneFactor, isNFLTDStat,
  isNBACountingStat, is3PTStat,
  impliedTeamTotal, SPORT_IMPLIED_BASELINE,
  mlbPlatoonFactor, strikeoutMatchupFactor, pitcherFormFactor,
  isMLBBattingStat, isMLBStrikeoutStat,
  nhlTimeOnIceFactor, powerPlayFactor, corsiFactor,
  FACTOR_CONFIG,
  type FactorResult,
} from "./factors";
import { logger } from "../logger";
import { normalizeStatType } from "../stat-type";

// Position-average USG% (possession share), 2024-25 NBA season.
// Used as the normalization target so computed proxy is in USG% scale (0-100).
const NBA_USG_BASELINE_PCT: Record<string, number> = {
  PG: 28, SG: 25, SF: 22, PF: 20, C: 18,
};

// NHL position-based average TOI per game (minutes) — 2024-25 season baselines.
// Compares a player's actual TOI to their positional peer group to detect
// top-line overperformers (high TOI → more scoring opportunity) vs depth players.
// Source: NHL Stats skater summary, season avg across all players ≥10 GP.
const NHL_TOI_POSITION_BASELINE: Record<string, number> = {
  C:  16.5,  // center
  LW: 15.5,  // left wing
  RW: 15.5,  // right wing
  F:  16.0,  // generic forward
  D:  21.0,  // defenseman
  G:  0,     // goalie — TOI factor not applicable to goalie props
};

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

// Pre-loaded cache passed from computeAllProjections to avoid N+1 DB queries.
type GameLog = typeof playerGameLogsTable.$inferSelect;
type MatchupRow = typeof matchupHistoryTable.$inferSelect;
type InjuryRow = typeof injuriesTable.$inferSelect;
interface ProjectionCache {
  gameLogs: Map<string, GameLog[]>;         // key: `${playerId}:${statType}` (top 20, desc)
  allLogsForPlayer: Map<number, GameLog[]>; // key: playerId — all stat types (combo fallback)
  matchup: Map<string, MatchupRow>;         // key: `${playerId}:${opponentTeamId}:${statType}`
  injury: Map<number, InjuryRow>;           // key: playerId
}

export async function computeProjection(
  playerId: number,
  statType: string,
  ppLine: number,
  lineType: string,
  sport: string,
  opponentTeamId?: number | null,
  calibrationMap?: CalibrationMap | null,
  cache?: ProjectionCache,
): Promise<ProjectionOutput> {
  // Normalise before every downstream lookup so abbreviations ("PTS") and
  // alternate spellings ("3-Pointers Made") resolve to the canonical DB form
  // ("Points", "3-PT Made"). This ensures game-log cache hits, prior lookups,
  // calibration bucket matches, and distribution family selection all agree.
  statType = normalizeStatType(statType);

  const prior = getPrior(sport, statType);
  const deductions: string[] = [];

  // --- 1. Fetch game logs (last 20, use up to 15) ---
  // Use pre-loaded batch cache when available; fall back to DB for single-player calls.
  const cacheKey = `${playerId}:${statType}`;
  const logs: GameLog[] = cache?.gameLogs.has(cacheKey)
    ? cache.gameLogs.get(cacheKey)!
    : await db
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
    type ComponentLog = Pick<GameLog, "gameDate" | "statType" | "value">;
    let componentLogs: ComponentLog[];
    const cachedPlayerLogs = cache?.allLogsForPlayer.get(playerId);
    if (cachedPlayerLogs) {
      componentLogs = cachedPlayerLogs.filter(l => comboComponents.includes(l.statType)).slice(0, 60);
    } else {
      componentLogs = await db
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
    }

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
      const matchupCacheKey = `${playerId}:${opponentTeamId}:${statType}`;
      const [matchup] = cache?.matchup
        ? [cache.matchup.get(matchupCacheKey)]
        : await db
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
    const [injury] = cache?.injury
      ? [cache.injury.get(playerId)]
      : await db
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
    lineType === "goblin" ? `Goblin line — std widened ${Math.round((stdAdj - 1) * 100)}%, naturally easier to beat`
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
  const [fatigueRows, paceRows, nflUsageMap, dvpRows, lineupConfirmRows, pitcherProfileRows, nhlContextRows] = await Promise.all([
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
    // Lineup confirmations for NBA/WNBA minutes projection factor.
    playerIds.length
      ? db.select().from(lineupConfirmationsTable)
          .where(inArray(lineupConfirmationsTable.playerId, playerIds))
          .orderBy(desc(lineupConfirmationsTable.confirmedAt))
      : Promise.resolve([] as (typeof lineupConfirmationsTable.$inferSelect)[]),
    // MLB pitcher hand profiles (for platoon split factor).
    db.select().from(pitcherProfilesTable).where(eq(pitcherProfilesTable.sport, "MLB")),
    // NHL player context (TOI, PP unit, Corsi) for NHL Saber Sim factors.
    playerIds.length
      ? db.select().from(nhlPlayerContextTable)
          .where(inArray(nhlPlayerContextTable.playerId, playerIds))
      : Promise.resolve([] as (typeof nhlPlayerContextTable.$inferSelect)[]),
  ]);

  // Index fatigue (first row per player = latest).
  const fatigueByPlayer = new Map<number, typeof fatigueDataTable.$inferSelect>();
  for (const f of fatigueRows) if (!fatigueByPlayer.has(f.playerId)) fatigueByPlayer.set(f.playerId, f);

  // Index NHL player context (one row per player).
  const nhlContextByPlayer = new Map<number, typeof nhlPlayerContextTable.$inferSelect>();
  for (const ctx of nhlContextRows) nhlContextByPlayer.set(ctx.playerId, ctx);

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

  // Build team-wide 3PM-ALLOWED map from DvP data (all positions aggregated).
  // Uses exact stat-type match on "3-PT Made" to avoid mixing in 3PA rows.
  // Keyed by `${sport}:${opponentTeamId}` to prevent cross-league blending.
  const team3PMAllowed = new Map<string, { sum: number; cnt: number }>();
  for (const r of dvpRows) {
    if (!r.opponentTeamId || !r.sport) continue;
    if (r.statType !== "3-PT Made") continue; // exact match — no 3PA contamination
    const avg = parseFloat(r.avgValue);
    const cnt = parseInt(r.games, 10);
    const key = `${r.sport}:${r.opponentTeamId}`;
    const cur = team3PMAllowed.get(key) ?? { sum: 0, cnt: 0 };
    cur.sum += avg * cnt;
    cur.cnt += cnt;
    team3PMAllowed.set(key, cur);
  }
  // League-average 3PM-allowed per sport (for ratio baseline in threePointDefenseFactor).
  const league3PMBySport = new Map<string, number>(); // sport → avg 3PM allowed/game
  const sportAgg3PM = new Map<string, { sum: number; cnt: number }>();
  for (const [key, v] of team3PMAllowed) {
    const sp = key.split(":")[0];
    const cur = sportAgg3PM.get(sp) ?? { sum: 0, cnt: 0 };
    cur.sum += v.sum;
    cur.cnt += v.cnt;
    sportAgg3PM.set(sp, cur);
  }
  for (const [sp, agg] of sportAgg3PM) {
    if (agg.cnt > 0) league3PMBySport.set(sp, agg.sum / agg.cnt);
  }

  // Index lineup confirmations: most recent per (playerId, gameId).
  const lineupByPlayerGame = new Map<string, typeof lineupConfirmationsTable.$inferSelect>();
  for (const lc of lineupConfirmRows) {
    const k = `${lc.playerId}:${lc.gameId}`;
    if (!lineupByPlayerGame.has(k)) lineupByPlayerGame.set(k, lc);
  }

  // Load the calibration table once and reuse it for every projection this run.
  const calibrationMap = await loadCalibrationMap();

  // ── Batch-load per-player data to eliminate N+1 queries in the inner loop ──
  // One query per data type instead of one per player.
  const allGameLogs = playerIds.length
    ? await db.select().from(playerGameLogsTable)
        .where(inArray(playerGameLogsTable.playerId, playerIds))
        .orderBy(desc(playerGameLogsTable.gameDate))
    : [] as (typeof playerGameLogsTable.$inferSelect)[];

  const gameLogsByKey = new Map<string, (typeof playerGameLogsTable.$inferSelect)[]>();
  const allLogsByPlayer = new Map<number, (typeof playerGameLogsTable.$inferSelect)[]>();
  for (const log of allGameLogs) {
    const k = `${log.playerId}:${log.statType}`;
    const kArr = gameLogsByKey.get(k) ?? [];
    if (kArr.length < 20) kArr.push(log);
    gameLogsByKey.set(k, kArr);
    const pArr = allLogsByPlayer.get(log.playerId) ?? [];
    pArr.push(log);
    allLogsByPlayer.set(log.playerId, pArr);
  }

  // ── NBA/WNBA Saber Sim pre-computations ────────────────────────────────────

  // Season-average minutes per player (deduplicated by gameDate to avoid
  // counting the same game multiple times across stat-type rows).
  const avgMinutesByPlayer = new Map<number, number>();
  for (const [playerId, logs] of allLogsByPlayer) {
    const gameMins = new Map<string, number>(); // gameDate → minutes
    for (const log of logs) {
      if (log.minutes != null && !gameMins.has(log.gameDate)) {
        const m = parseFloat(log.minutes.toString());
        if (m > 0) gameMins.set(log.gameDate, m);
      }
    }
    if (gameMins.size === 0) continue;
    const arr = [...gameMins.values()].slice(0, 20);
    avgMinutesByPlayer.set(playerId, arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  // Per-game average per (player, statType) — used by USG% computation below.
  // Requires ≥3 recent games to emit a signal.
  const avgValPerGameByKey = new Map<string, number>(); // `${playerId}:${statType}` → avg val/game
  for (const [key, logs] of gameLogsByKey) {
    const recent = logs.slice(0, 20);
    if (recent.length < 3) continue;
    const avgVal = recent.reduce((s, l) => s + parseFloat(l.value.toString()), 0) / recent.length;
    if (avgVal >= 0) avgValPerGameByKey.set(key, avgVal);
  }

  // NBA/WNBA USG% proxy per player.
  // Formula: USG% = 100 × (FGA_est + 0.44×FTA_est + TOV) × (Tm_MP/5) / (MP_avg × Tm_possUsed)
  // FGA is estimated from Points + 3PM (FGA not tracked as a PrizePicks prop):
  //   2PA ≈ (Points − 3PM×3) / 2 / 0.53   (2-pt FGM ÷ 2pt FG%)
  //   3PA ≈ 3PM / 0.36                     (3PM ÷ league-avg 3P%)
  // FTA is estimated from Points (FT ≈ 15% of NBA scoring at 77% FT%).
  // Turnovers are read directly from the "Turnovers" game-log rows (IS a tracked stat).
  const NBA_TM_POSS_USED = 112.0; // NBA avg: FGA + 0.44×FTA + TOV per team per game
  const NBA_TM_MP        = 240;   // 5 players × 48 min
  const playerUSGByPlayerId = new Map<number, number>(); // playerId → USG% (0–100)
  for (const [pidStr] of avgValPerGameByKey) {
    const pId = parseInt(pidStr.split(":")[0], 10);
    if (playerUSGByPlayerId.has(pId)) continue; // already computed for this player
    const pts     = avgValPerGameByKey.get(`${pId}:Points`) ?? null;
    if (pts == null) continue;
    const tov    = avgValPerGameByKey.get(`${pId}:Turnovers`) ?? 0;
    const threepm = avgValPerGameByKey.get(`${pId}:3-PT Made`) ?? 0;
    const mpAvg  = avgMinutesByPlayer.get(pId);
    if (!mpAvg || mpAvg <= 0) continue;
    // FGA estimation
    const twoFGM = Math.max(0, pts - 3 * threepm);
    const twoPA  = twoFGM / 2 / 0.53;
    const threePA = threepm / 0.36;
    const fgaEst = twoPA + threePA;
    // FTA estimation
    const ftaEst = pts * 0.15 / 0.77;
    // USG%
    const possUsed = fgaEst + 0.44 * ftaEst + tov;
    const usg = 100 * possUsed * (NBA_TM_MP / 5) / (mpAvg * NBA_TM_POSS_USED);
    playerUSGByPlayerId.set(pId, Math.round(Math.max(5, Math.min(50, usg)) * 10) / 10);
  }

  // ── MLB Saber Sim pre-computations ─────────────────────────────────────────

  /** Shape of game.metadata for MLB games with lineup info populated by schedule sync. */
  interface GameMetaMlb {
    homeStartingPitcher?: string;
    awayStartingPitcher?: string;
  }

  /** Pitcher stats derived from player_game_logs when pitcher exists in DB. */
  interface PitcherStats {
    kPct: number | null;        // K% (fraction 0..1): K per batter faced proxy
    lastNERA: number | null;    // ERA over last 3 starts
    seasonFIP: number | null;   // FIP proxy = (13HR + 3BB - 2K) / IP + 3.2
  }

  // Pitcher hand lookup: pitcher name (lower) → "L" | "R"
  const pitcherHandMap = new Map(
    pitcherProfileRows.map(p => [p.playerName.toLowerCase(), p.hand as "L" | "R"])
  );

  // Today's opposing pitcher hand, keyed by `${gameId}:${playerTeamId}`.
  // Away batters face the home SP; home batters face the away SP.
  const mlbOpposingPitcherHand = new Map<string, "L" | "R">();
  for (const game of games) {
    if (!game.metadata) continue;
    const meta = game.metadata as GameMetaMlb;
    if (meta.homeStartingPitcher) {
      const hand = pitcherHandMap.get(meta.homeStartingPitcher.toLowerCase());
      if (hand) mlbOpposingPitcherHand.set(`${game.id}:${game.awayTeamId}`, hand);
    }
    if (meta.awayStartingPitcher) {
      const hand = pitcherHandMap.get(meta.awayStartingPitcher.toLowerCase());
      if (hand) mlbOpposingPitcherHand.set(`${game.id}:${game.homeTeamId}`, hand);
    }
  }

  // Batter platoon splits: Map<`${playerId}:${statType}`, split stats>
  interface MlbPlatoonSplit {
    avgVsLeft:    number | null;
    gamesVsLeft:  number;
    avgVsRight:   number | null;
    gamesVsRight: number;
    overallAvg:   number | null;
  }
  const mlbBatterSplits = new Map<string, MlbPlatoonSplit>();

  // Batter K% proxy: K per game / ~4 PA estimate → K% as fraction (0..1)
  const mlbBatterKPct = new Map<number, number>();

  const mlbPlayerIdSet = new Set(
    activeLines.filter(r => r.player.sport === "MLB").map(r => r.line.playerId)
  );

  if (mlbPlayerIdSet.size > 0) {
    // Accumulate batter stats from all loaded game logs (pitcherHand populated
    // after schema push + next game-log sync; returns null splits until then).
    const splitAcc = new Map<string, { vsL: number[]; vsR: number[]; all: number[] }>();
    for (const log of allGameLogs) {
      if (!mlbPlayerIdSet.has(log.playerId)) continue;
      const key = `${log.playerId}:${log.statType}`;
      const acc = splitAcc.get(key) ?? { vsL: [], vsR: [], all: [] };
      const v = parseFloat(log.value.toString());
      acc.all.push(v);
      if (log.pitcherHand === "L") acc.vsL.push(v);
      else if (log.pitcherHand === "R") acc.vsR.push(v);
      splitAcc.set(key, acc);
    }
    const safeAvg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    for (const [key, acc] of splitAcc) {
      mlbBatterSplits.set(key, {
        avgVsLeft:    safeAvg(acc.vsL),
        gamesVsLeft:  acc.vsL.length,
        avgVsRight:   safeAvg(acc.vsR),
        gamesVsRight: acc.vsR.length,
        overallAvg:   safeAvg(acc.all),
      });
    }

    // Batter K% from strikeout game logs (≥5 games required)
    for (const playerId of mlbPlayerIdSet) {
      const kLogs = (allLogsByPlayer.get(playerId) ?? [])
        .filter(l => l.statType === "Hitter Strikeouts");
      if (kLogs.length < 5) continue;
      const recent = kLogs.slice(0, 20);
      const avgKPerGame = recent.reduce((s, l) => s + parseFloat(l.value.toString()), 0) / recent.length;
      mlbBatterKPct.set(playerId, Math.min(avgKPerGame / 4, 0.50));
    }
  }

  // Pitcher game-log stats (K%, ERA, FIP) — computed from player_game_logs where
  // MLB pitchers exist as players with positions SP/P/RP.  Currently empty until
  // a pitcher-log sync is added; factors gracefully return null when data is absent.
  const pitcherGameStatsMap = new Map<string, PitcherStats>();
  const mlbPitcherPlayers = await db.select({ id: playersTable.id, fullName: playersTable.fullName })
    .from(playersTable)
    .where(and(
      eq(playersTable.sport, "MLB"),
      inArray(playersTable.position, ["SP", "P", "RP"]),
    ));

  if (mlbPitcherPlayers.length > 0) {
    const pitcherIds = mlbPitcherPlayers.map(p => p.id);
    const pitcherLogs = await db.select().from(playerGameLogsTable)
      .where(inArray(playerGameLogsTable.playerId, pitcherIds))
      .orderBy(desc(playerGameLogsTable.gameDate));

    const logsByPitcher = new Map<number, typeof pitcherLogs>();
    for (const log of pitcherLogs) {
      const arr = logsByPitcher.get(log.playerId) ?? [];
      arr.push(log);
      logsByPitcher.set(log.playerId, arr);
    }

    for (const pitcher of mlbPitcherPlayers) {
      const logs = logsByPitcher.get(pitcher.id) ?? [];
      if (logs.length === 0) continue;

      // Group logs by gameDate → per-start stat snapshot
      const byDate = new Map<string, Record<string, number>>();
      for (const log of logs) {
        const st = byDate.get(log.gameDate) ?? {};
        st[log.statType.toLowerCase()] = parseFloat(log.value.toString());
        byDate.set(log.gameDate, st);
      }
      const starts = [...byDate.values()];

      // K%: K per batter faced proxy from last 5 starts (K / (IP × 3))
      // "Pitcher Strikeouts" and "Pitching Outs" match what historical-stats.ts writes.
      // Pitching Outs = total outs recorded; divide by 3 to convert to innings pitched.
      const kStarts = starts.slice(0, 5)
        .filter(s => s["pitcher strikeouts"] != null && (s["pitching outs"] ?? 0) > 0);
      let kPct: number | null = null;
      if (kStarts.length >= 2) {
        const totalK    = kStarts.reduce((s, st) => s + (st["pitcher strikeouts"] ?? 0), 0);
        const totalOuts = kStarts.reduce((s, st) => s + (st["pitching outs"] ?? 0), 0);
        const totalIP   = totalOuts / 3;
        kPct = totalIP > 0 ? Math.min(totalK / (totalIP * 3), 0.45) : null;
      }

      // Last 3 starts ERA: (earned runs / IP) × 9
      const eraStarts = starts.slice(0, 3)
        .filter(s => s["earned runs allowed"] != null && (s["pitching outs"] ?? 0) > 0);
      let lastNERA: number | null = null;
      if (eraStarts.length >= 1) {
        const totalER   = eraStarts.reduce((s, st) => s + (st["earned runs allowed"] ?? 0), 0);
        const totalOuts = eraStarts.reduce((s, st) => s + (st["pitching outs"] ?? 0), 0);
        const totalIP   = totalOuts / 3;
        lastNERA = totalIP > 0 ? (totalER / totalIP) * 9 : null;
      }

      // Season FIP proxy: (13×HR + 3×BB − 2×K) / IP + 3.2
      // "Walks Allowed", "Home Runs Allowed" match historical-stats.ts pitcher stat names.
      const allFIPStarts = starts.filter(s => (s["pitching outs"] ?? 0) > 0);
      let seasonFIP: number | null = null;
      if (allFIPStarts.length >= 3) {
        const totalHR   = allFIPStarts.reduce((s, st) => s + (st["home runs allowed"] ?? 0), 0);
        const totalBB   = allFIPStarts.reduce((s, st) => s + (st["walks allowed"] ?? 0), 0);
        const totalK    = allFIPStarts.reduce((s, st) => s + (st["pitcher strikeouts"] ?? 0), 0);
        const totalOuts = allFIPStarts.reduce((s, st) => s + (st["pitching outs"] ?? 0), 0);
        const totalIP   = totalOuts / 3;
        const fip = ((13 * totalHR + 3 * totalBB - 2 * totalK) / totalIP) + 3.2;
        seasonFIP = Number.isFinite(fip) ? Math.max(1.0, Math.min(9.0, fip)) : null;
      }

      if (kPct != null || lastNERA != null || seasonFIP != null) {
        pitcherGameStatsMap.set(pitcher.fullName.toLowerCase(), { kPct, lastNERA, seasonFIP });
      }
    }
  }

  const opponentIds = [...new Set(
    activeLines
      .filter(r => r.line.gameId != null && r.player.teamId != null)
      .flatMap(r => {
        const game = gameMap[r.line.gameId!];
        if (!game) return [] as number[];
        const oppId = game.homeTeamId === r.player.teamId ? game.awayTeamId : game.homeTeamId;
        return oppId != null ? [oppId] : ([] as number[]);
      }),
  )];

  const matchupBatchRows = playerIds.length && opponentIds.length
    ? await db.select().from(matchupHistoryTable)
        .where(and(
          inArray(matchupHistoryTable.playerId, playerIds),
          inArray(matchupHistoryTable.opponentTeamId, opponentIds),
        ))
    : [] as (typeof matchupHistoryTable.$inferSelect)[];

  const matchupByKey = new Map<string, typeof matchupHistoryTable.$inferSelect>();
  for (const m of matchupBatchRows) {
    matchupByKey.set(`${m.playerId}:${m.opponentTeamId}:${m.statType}`, m);
  }

  const injuryBatchRows = playerIds.length
    ? await db.select().from(injuriesTable)
        .where(inArray(injuriesTable.playerId, playerIds))
        .orderBy(desc(injuriesTable.reportedAt))
    : [] as (typeof injuriesTable.$inferSelect)[];

  const injuryByPlayer = new Map<number, typeof injuriesTable.$inferSelect>();
  for (const inj of injuryBatchRows) {
    if (!injuryByPlayer.has(inj.playerId)) injuryByPlayer.set(inj.playerId, inj);
  }

  const projCache: ProjectionCache = {
    gameLogs: gameLogsByKey,
    allLogsForPlayer: allLogsByPlayer,
    matchup: matchupByKey,
    injury: injuryByPlayer,
  };

  let computed = 0;
  const projectionPayloads: (typeof ourProjectionsTable.$inferInsert)[] = [];

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
        projCache,
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

      // NFL advanced usage + snap + red zone
      if (sport === "NFL") {
        const usage = nflUsageMap.get(player.fullName.toLowerCase());
        if (usage) {
          factors.push(nflAdvancedFactor({
            targetShare:   usage.targetShare,
            airYardsShare: usage.airYardsShare,
            wopr:          usage.wopr,
            aDot:          usage.aDot,
            statType:      line.statType,
          }));
          factors.push(snapFactor(usage.snapPct));
          if (isNFLTDStat(line.statType)) {
            factors.push(redZoneFactor({
              redZoneTargetShare: usage.redZoneTargetShare,
              redZoneCarryShare:  usage.redZoneCarryShare,
              position:           player.position,
              statType:           line.statType,
            }));
          }
        }
      }

      // MLB park + Saber Sim factors
      if (sport === "MLB") {
        const isBatterProp = isMLBBattingStat(line.statType);
        const isKProp = isMLBStrikeoutStat(line.statType);

        // Park factor (requires known home team abbreviation)
        if (game) {
          const homeAbbr = teamAbbrMap.get(game.homeTeamId);
          if (homeAbbr && isBatterProp) {
            factors.push(parkFactor(MLB_PARK_FACTORS[homeAbbr.toUpperCase()] ?? null, homeAbbr));
          }
        }

        // Resolve opposing pitcher info from game metadata
        let pitcherStats: PitcherStats | undefined;
        let opposingPitcherHand: "L" | "R" | undefined;

        if (game) {
          const meta = (game.metadata ?? null) as GameMetaMlb | null;
          // Home batter faces away SP; away batter faces home SP
          const pitcherName = meta
            ? (game.homeTeamId === player.teamId
                ? meta.awayStartingPitcher
                : meta.homeStartingPitcher)
            : undefined;
          if (pitcherName) pitcherStats = pitcherGameStatsMap.get(pitcherName.toLowerCase());
          if (player.teamId) {
            opposingPitcherHand = mlbOpposingPitcherHand.get(`${game.id}:${player.teamId}`);
          }
        }

        // 1. Platoon split factor — fires when pitcher hand known + ≥5 split games
        if (isBatterProp && opposingPitcherHand) {
          const split = mlbBatterSplits.get(`${line.playerId}:${line.statType}`);
          if (split) {
            const avgVsHand   = opposingPitcherHand === "L" ? split.avgVsLeft  : split.avgVsRight;
            const gamesVsHand = opposingPitcherHand === "L" ? split.gamesVsLeft : split.gamesVsRight;
            factors.push(mlbPlatoonFactor({ avgVsHand, overallAvg: split.overallAvg, gamesVsHand }));
          }
        }

        // 2. K-rate matchup — batter strikeout props only; pitcher K% optional
        if (isKProp) {
          factors.push(strikeoutMatchupFactor({
            batterKPct:  mlbBatterKPct.get(line.playerId) ?? null,
            pitcherKPct: pitcherStats?.kPct ?? null,
            statType:    line.statType,
          }));
        }

        // 3. Pitcher form — all batting props; needs pitcher ERA + FIP
        if (isBatterProp) {
          factors.push(pitcherFormFactor({
            lastNStartsERA: pitcherStats?.lastNERA ?? null,
            seasonFIP:      pitcherStats?.seasonFIP ?? null,
            statType:       line.statType,
          }));
        }
      }

      // ── NHL Saber Sim factors ──────────────────────────────────────────────
      if (sport === "NHL") {
        const nhlCtx = nhlContextByPlayer.get(line.playerId);
        if (nhlCtx) {
          const toiPerGame    = nhlCtx.toiPerGame    != null ? parseFloat(nhlCtx.toiPerGame.toString())    : null;
          const ppToiPerGame  = nhlCtx.ppToiPerGame  != null ? parseFloat(nhlCtx.ppToiPerGame.toString())  : null;
          const ppUnit        = nhlCtx.ppUnit ?? null;
          const corsiFor60    = nhlCtx.corsiFor60    != null ? parseFloat(nhlCtx.corsiFor60.toString())    : null;

          // 1. TOI factor — compare player's season-avg TOI to their positional
          //    peer-group baseline (forward ~16 min, defenseman ~21 min).
          //    Top-liners above the baseline get a positive role boost; depth
          //    players below it get a negative adjustment on counting stats.
          //    When a projected-TOI source is wired (follow-up #192), replace
          //    `toiPerGame` (1st arg) with the nightly projected value.
          const posBaseline = player.position
            ? (NHL_TOI_POSITION_BASELINE[player.position] ?? null)
            : null;
          factors.push(nhlTimeOnIceFactor(toiPerGame, posBaseline, line.statType));

          // 2. Power-play factor (ratio-driven) — fires for Goals/Assists/Points.
          //    boost = (ppToi / totalToi) × (ppEfficiency − 1); no-op when player
          //    has < 0.5 min/game PP ice time.
          factors.push(powerPlayFactor(ppToiPerGame, toiPerGame, ppUnit, line.statType));

          // 3. Corsi factor — fires for Shots on Goal only.
          //    65 CF/60 vs 55 → weight 1.0 → (65/55−1) × 1.0 ≈ +18%.
          factors.push(corsiFactor(
            corsiFor60,
            FACTOR_CONFIG.nhlCorsi.leagueAvgCF60,
            line.statType,
          ));
        }
      }

      // ── NBA/WNBA Saber Sim factors ─────────────────────────────────────────
      let usageRateIdx: number | null = null;
      if (sport === "NBA" || sport === "WNBA") {
        // 1. Minutes projection factor
        const lcKey = line.gameId != null ? `${line.playerId}:${line.gameId}` : null;
        const lc = lcKey ? lineupByPlayerGame.get(lcKey) : null;
        const expMin = lc?.expectedMinutes != null ? parseFloat(lc.expectedMinutes.toString()) : null;
        const seasonAvgMin = avgMinutesByPlayer.get(line.playerId) ?? null;
        factors.push(minutesFactor(expMin, seasonAvgMin, line.statType));

        // 2. Usage rate factor — USG% proxy (FGA/FTA estimated from Points+3PM; TOV direct)
        if (isNBACountingStat(line.statType)) {
          const usagePct = playerUSGByPlayerId.get(line.playerId) ?? null;
          const usgBaselinePct = NBA_USG_BASELINE_PCT[player.position ?? ""] ?? null;
          const uf = usageRateFactor(usagePct, usgBaselinePct, line.statType);
          factors.push(uf);
          if (usagePct != null) usageRateIdx = usagePct; // store USG% proxy (0-100)
        }

        // 3. 3-point defense factor (team-wide 3PM allowed vs sport-partitioned league avg)
        if (is3PTStat(line.statType) && opponentTeamId != null) {
          const t3pmKey = `${sport}:${opponentTeamId}`;
          const t3pm = team3PMAllowed.get(t3pmKey);
          const allowed3PM = t3pm && t3pm.cnt > 0 ? t3pm.sum / t3pm.cnt : null;
          factors.push(threePointDefenseFactor({
            allowed3PM,
            league3PM: league3PMBySport.get(sport) ?? null,
            games: t3pm?.cnt ?? null,
          }));
        }
      }

      const { combinedFactor, applied } = combineFactors(factors);
      const adjustedMean = Math.round(result.mean * combinedFactor * 100) / 100;

      // aDOT stdDev variance modifier — widens/narrows stored stdDev for deep/short routes
      const nflAdvApplied = applied.find(f => f.key === "nflAdvanced");
      const stdDevMultiplier = nflAdvApplied?.stdMultiplier ?? 1;
      const adjustedStdDev = result.stdDev * stdDevMultiplier;

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
        stdDev: adjustedStdDev.toString(),
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
        usageRate: usageRateIdx != null ? usageRateIdx.toString() : null,
        expiresAt: result.expiresAt,
        generatedAt: new Date(),
      };

      projectionPayloads.push(payload);
      computed++;
    } catch (e) {
      logger.error({ err: e, lineId: line.id }, "Projection compute error");
    }
  }

  // Bulk upsert all computed projections in one DB round-trip.
  if (projectionPayloads.length > 0) {
    await db.insert(ourProjectionsTable).values(projectionPayloads)
      .onConflictDoUpdate({
        target: [ourProjectionsTable.playerId, ourProjectionsTable.statType],
        set: {
          gameId:           sql`excluded.game_id`,
          projectedValue:   sql`excluded.projected_value`,
          weightedAvg:      sql`excluded.weighted_avg`,
          gamesUsed:        sql`excluded.games_used`,
          confidence:       sql`excluded.confidence`,
          modelVersion:     sql`excluded.model_version`,
          stdDev:           sql`excluded.std_dev`,
          p99:              sql`excluded.p99`,
          pOver:            sql`excluded.p_over`,
          percentileAtLine: sql`excluded.percentile_at_line`,
          dataQualityScore: sql`excluded.data_quality_score`,
          shrinkageFactor:  sql`excluded.shrinkage_factor`,
          noPlayReason:     sql`excluded.no_play_reason`,
          sourceLabel:      sql`excluded.source_label`,
          opponentAdj:      sql`excluded.opponent_adj`,
          paceFactor:       sql`excluded.pace_factor`,
          defenseFactor:    sql`excluded.defense_factor`,
          restFactor:       sql`excluded.rest_factor`,
          adjustments:      sql`excluded.adjustments`,
          ensembleBlendPct: sql`excluded.ensemble_blend_pct`,
          vor:              sql`excluded.vor`,
          usageRate:        sql`excluded.usage_rate`,
          expiresAt:        sql`excluded.expires_at`,
          generatedAt:      sql`excluded.generated_at`,
        },
      });
  }

  logger.info({ computed }, "computeAllProjections done");
  return computed;
}
