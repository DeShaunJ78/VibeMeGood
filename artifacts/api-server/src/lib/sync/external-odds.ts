import { db } from "@workspace/db";
import {
  externalLinesTable, ppLinesTable, playersTable, propScoresTable,
  lineMoveEventsTable, ourProjectionsTable, dataPullLogsTable,
  playerGameLogsTable, userSettingsTable, entryPicksTable,
} from "@workspace/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { logger } from "../logger";
import { twoWayHold, noVigProbs } from "../analytics/odds-math";
import { pOverLine } from "../projection/normal-dist";
import { calibratePOver, loadCalibrationMap } from "../projection/calibration";
import { effectivePayoutMultiplier } from "../payout/multiplier";

const ODDS_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const ODDS_KEY = process.env.ODDS_API_KEY || "";

const SPORT_KEYS: Record<string, string> = {
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  NFL: "americanfootball_nfl",
  WNBA: "basketball_wnba",
};

// Basketball player-prop markets (shared by NBA + WNBA on the Odds API).
const BASKETBALL_MARKETS: Record<string, string> = {
  "Points": "player_points",
  "Rebounds": "player_rebounds",
  "Assists": "player_assists",
  "Blocks": "player_blocks",
  "Steals": "player_steals",
  "Turnovers": "player_turnovers",
  "Free Throws Made": "player_free_throws_made",
  "Blks+Stls": "player_blocks_steals",
  "3-PT Made": "player_threes",
  "Pts+Rebs+Asts": "player_points_rebounds_assists",
  "Pts+Rebs": "player_points_rebounds",
  "Pts+Asts": "player_points_assists",
  "Rebs+Asts": "player_rebounds_assists",
  "Double-Double": "player_double_double",
  "Triple-Double": "player_triple_double",
};

/**
 * PrizePicks stat_type -> Odds API market key, nested by sport. Sport-aware
 * because the same Odds market key is invalid across sports (e.g. baseball uses
 * "batter_"/"pitcher_" prefixes, basketball and hockey use "player_"). Every key
 * below is verified valid on the per-EVENT odds endpoint. Only include verified keys: a
 * single unsupported market makes the Odds API reject the whole event request.
 */
const SPORT_STAT_MARKETS: Record<string, Record<string, string>> = {
  MLB: {
    "Hits": "batter_hits",
    "Total Bases": "batter_total_bases",
    "Home Runs": "batter_home_runs",
    "RBIs": "batter_rbis",
    "Runs": "batter_runs_scored",
    "Singles": "batter_singles",
    "Doubles": "batter_doubles",
    "Walks": "batter_walks",
    "Stolen Bases": "batter_stolen_bases",
    "Hitter Strikeouts": "batter_strikeouts",
    "Hits+Runs+RBIs": "batter_hits_runs_rbis",
    "Pitcher Strikeouts": "pitcher_strikeouts",
    "Pitching Outs": "pitcher_outs",
    "Hits Allowed": "pitcher_hits_allowed",
    "Walks Allowed": "pitcher_walks",
    "Earned Runs Allowed": "pitcher_earned_runs",
  },
  NBA: BASKETBALL_MARKETS,
  WNBA: BASKETBALL_MARKETS,
  NHL: {
    "Points": "player_points",
    "Assists": "player_assists",
    "Goals": "player_goals",
    "Shots On Goal": "player_shots_on_goal",
    "Blocked Shots": "player_blocked_shots",
    "Power Play Points": "player_power_play_points",
    "Goalie Saves": "player_total_saves",
  },
  NFL: {
    "Pass Yards": "player_pass_yds",
    "Rush Yards": "player_rush_yds",
    "Receiving Yards": "player_reception_yds",
    "Receptions": "player_receptions",
    "Pass TDs": "player_pass_tds",
    "Rush TDs": "player_rush_tds",
    "Rec TDs": "player_reception_tds",
    "Completions": "player_pass_completions",
    "Pass Attempts": "player_pass_attempts",
    "Rush Attempts": "player_rush_attempts",
    "Anytime TD Scorer": "player_anytime_td",
  },
};

/** Minimum ms between successful external-odds syncs (normal cron path).
 *  Sits just under the 3-hour cron so each slot produces exactly one fetch,
 *  while rapid/overlapping triggers are coalesced into a score recalc only. */
const MIN_INTERVAL_MS = 170 * 60 * 1000; // 170 minutes (just under 3 h)

/** Stop spending credits if the Odds API says fewer than this remain for the month. */
const LOW_CREDITS_THRESHOLD = 2_000;

/** Last known credit balance from the x-requests-remaining header. Persists across
 *  calls within the same server process so the guard works even before the first sync. */
let lastKnownRemaining: number | null = null;
/** Only pull player props for games starting within this window of "lock"
 *  (game start). Keeps credit spend proportional to the imminent slate — games
 *  further out are skipped entirely (the events list call itself is free). */
const ODDS_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
/**
 * Floor for FORCED (pre-lock) syncs. force still skips the normal hourly guard
 * for urgency, but never refetches faster than this — protects paid Odds API
 * credits if /sync/pre-lock is hit repeatedly. 5 min is well inside any
 * pre-lock window so freshness is unaffected.
 */
const FORCE_FLOOR_MS = 5 * 60 * 1000; // 5 minutes

/** In-flight guard: concurrent callers join the same run instead of double-fetching. */
let inFlight: Promise<number> | null = null;

/**
 * @param force - skip the normal hourly cooldown for urgency (pre-lock only). Still
 *   subject to FORCE_FLOOR_MS and the in-flight guard so it cannot be abused.
 */
export async function syncExternalOdds(force = false): Promise<number> {
  if (inFlight) {
    logger.info("external-odds: sync already in flight — joining existing run");
    return inFlight;
  }
  inFlight = runSyncExternalOdds(force).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSyncExternalOdds(force = false): Promise<number> {
  // --- Credit guard: skip the API calls if we synced too recently ---
  // Normal path: 50 min. Forced (pre-lock) path: 5 min floor. Either way a
  // skip falls back to recalcing scores from existing data (no API spend).
  const floorMs = force ? FORCE_FLOOR_MS : MIN_INTERVAL_MS;
  {
    // Gate on startedAt, NOT finishedAt: the hourly cron fires at :00, so a run
    // that takes >Δ minutes would push finishedAt past :00+Δ and make the next
    // hourly tick fall inside the window and skip — silently degrading to every
    // 2h near lock. startedAt is duration-independent, so :00 vs next :00 is
    // always a clean 60min ≥ floor.
    const [lastSuccess] = await db
      .select({ startedAt: dataPullLogsTable.startedAt })
      .from(dataPullLogsTable)
      .where(and(
        eq(dataPullLogsTable.jobName, "external-odds"),
        eq(dataPullLogsTable.status, "success"),
      ))
      .orderBy(desc(dataPullLogsTable.startedAt))
      .limit(1);

    if (lastSuccess?.startedAt &&
        Date.now() - lastSuccess.startedAt.getTime() < floorMs) {
      logger.info({ force, floorMs }, "external-odds: within min interval — skipping API calls, recalcing scores only");
      await recalcPropScores();
      return 0;
    }
  }

  if (!ODDS_KEY) {
    logger.warn("ODDS_API_KEY not set — skipping external odds fetch");
    await recalcPropScores();
    return 0;
  }

  const activeLines = await db
    .select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  const bySport: Record<string, typeof activeLines> = {};
  for (const r of activeLines) {
    const s = r.player.sport;
    if (!bySport[s]) bySport[s] = [];
    bySport[s].push(r);
  }

  let processed = 0;

  for (const [sport, lines] of Object.entries(bySport)) {
    const sportKey = SPORT_KEYS[sport];
    if (!sportKey) continue;

    const statToMarket = SPORT_STAT_MARKETS[sport];
    if (!statToMarket) continue;

    const neededMarkets = new Set(
      lines.map(l => statToMarket[l.line.statType]).filter(Boolean) as string[],
    );
    if (!neededMarkets.size) continue;

    // Reverse map (Odds API market key -> PrizePicks stat_type) for this sport.
    const marketToStat = new Map<string, string>();
    for (const [stat, mkt] of Object.entries(statToMarket)) marketToStat.set(mkt, stat);
    const marketsParam = [...neededMarkets].join(",");

    try {
      // 1) List upcoming events inside the credit window. The events endpoint is
      //    FREE (does not count against the Odds API quota), so this costs
      //    nothing and lets us pay only for games that are about to lock.
      const fromIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const toIso = new Date(Date.now() + ODDS_WINDOW_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
      const evRes = await fetch(
        `${ODDS_BASE}/sports/${sportKey}/events?` +
        `apiKey=${ODDS_KEY}&commenceTimeFrom=${fromIso}&commenceTimeTo=${toIso}&dateFormat=iso`,
      );
      if (!evRes.ok) {
        logger.warn({ sport, status: evRes.status }, "external-odds events list failed");
        continue;
      }
      const eventList = await evRes.json() as Array<{ id: string }>;
      if (!eventList.length) {
        logger.info({ sport }, "external-odds: no games within window — no credits spent");
        continue;
      }

      // 2) Player props live ONLY on the per-EVENT odds endpoint. Each call
      //    costs (markets x regions) credits, which is why the window above is
      //    kept tight. A single bad market key would 422 the whole event, so
      //    SPORT_STAT_MARKETS only contains verified keys.
      for (const evMeta of eventList) {
        // Credit guard: bail out before spending if we know balance is critically low.
        if (lastKnownRemaining !== null && lastKnownRemaining < LOW_CREDITS_THRESHOLD) {
          logger.warn({ lastKnownRemaining, threshold: LOW_CREDITS_THRESHOLD },
            "external-odds: Odds API credits critically low — skipping remaining events to preserve budget");
          break;
        }

        const oddsRes = await fetch(
          `${ODDS_BASE}/sports/${sportKey}/events/${evMeta.id}/odds?` +
          `apiKey=${ODDS_KEY}&regions=us&markets=${marketsParam}&oddsFormat=american`,
        );
        if (!oddsRes.ok) {
          logger.warn({ sport, eventId: evMeta.id, status: oddsRes.status }, "external-odds event odds failed");
          continue;
        }
        const remaining = oddsRes.headers.get("x-requests-remaining");
        const used = oddsRes.headers.get("x-requests-used");
        if (remaining !== null) {
          lastKnownRemaining = parseInt(remaining, 10);
          if (lastKnownRemaining < LOW_CREDITS_THRESHOLD) {
            logger.warn({ remaining: lastKnownRemaining, used, threshold: LOW_CREDITS_THRESHOLD },
              "external-odds: Odds API credits critically low — halting further fetches this cycle");
          } else {
            logger.info({ sport, remaining, used }, "Odds API credits");
          }
        }
        const event = await oddsRes.json() as any;
        for (const bookmaker of (event.bookmakers || [])) {
          for (const market of (bookmaker.markets || [])) {
            // Group outcomes by player description so we can pair over+under
            const byPlayer = new Map<string, any[]>();
            for (const o of (market.outcomes || [])) {
              const desc = (o.description || o.name || "").trim();
              if (!desc) continue;
              if (!byPlayer.has(desc)) byPlayer.set(desc, []);
              byPlayer.get(desc)!.push(o);
            }

            for (const [playerName, playerOutcomes] of byPlayer) {
              const overOutcome  = playerOutcomes.find((o: any) => o.name?.toLowerCase() === "over");
              const underOutcome = playerOutcomes.find((o: any) => o.name?.toLowerCase() === "under");
              if (!overOutcome?.point) continue;

              const statType = marketToStat.get(market.key);

              const playerMatches = lines.filter(l => {
                const ppLast  = l.player.fullName.split(" ").pop()?.toLowerCase() || "";
                const mktLast = playerName.split(" ").pop()?.toLowerCase() || "";
                const nameMatch = ppLast === mktLast || l.player.fullName.toLowerCase() === playerName.toLowerCase();
                const statMatch = statType ? l.line.statType === statType : true;
                return nameMatch && statMatch;
              });

              if (!playerMatches.length) continue;

              // Pick the tier closest to the sportsbook line value
              const sbLine = overOutcome.point;
              const match = playerMatches.reduce((best, curr) => {
                const bestDist = Math.abs(parseFloat(best.line.lineValue.toString()) - sbLine);
                const currDist = Math.abs(parseFloat(curr.line.lineValue.toString()) - sbLine);
                return currDist < bestDist ? curr : best;
              });

              const lineVal    = overOutcome.point.toString();
              const overPrice  = overOutcome.price  != null ? Number(overOutcome.price)  : null;
              const underPrice = underOutcome?.price != null ? Number(underOutcome.price) : null;

              let holdPctStr:        string | null = null;
              let noVigOverProbStr:  string | null = null;
              let noVigUnderProbStr: string | null = null;
              if (overPrice && underPrice) {
                const hold = twoWayHold(overPrice, underPrice);
                if (hold) holdPctStr = hold.toFixed(6);
                const nvProbs = noVigProbs(overPrice, underPrice);
                if (nvProbs) {
                  noVigOverProbStr  = nvProbs.overFair.toFixed(6);
                  noVigUnderProbStr = nvProbs.underFair.toFixed(6);
                }
              }

              const [existing] = await db.select().from(externalLinesTable)
                .where(and(
                  eq(externalLinesTable.ppLineId, match.line.id),
                  eq(externalLinesTable.bookName, bookmaker.key),
                )).limit(1);

              const existingVal = existing?.lineValue?.toString();
              if (existing && existingVal !== lineVal) {
                await db.insert(lineMoveEventsTable).values({
                  ppLineId: match.line.id,
                  bookName: bookmaker.key,
                  prevLine: existingVal || null,
                  newLine: lineVal,
                  moveSize: existingVal
                    ? (parseFloat(lineVal) - parseFloat(existingVal)).toString()
                    : null,
                  moveDirection: existingVal
                    ? parseFloat(lineVal) > parseFloat(existingVal) ? "up" : "down"
                    : null,
                  capturedAt: new Date(),
                });
              }

              await db.insert(externalLinesTable).values({
                playerId:       match.player.id,
                ppLineId:       match.line.id,
                statType:       match.line.statType,
                bookName:       bookmaker.key,
                lineValue:      lineVal,
                openingLine:    lineVal,
                overLine:       lineVal,
                underLine:      underOutcome?.point?.toString() ?? lineVal,
                overOdds:       overPrice,
                underOdds:      underPrice,
                holdPct:        holdPctStr,
                noVigOverProb:  noVigOverProbStr,
                noVigUnderProb: noVigUnderProbStr,
                pulledAt: new Date(),
              }).onConflictDoUpdate({
                target: [externalLinesTable.ppLineId, externalLinesTable.bookName],
                set: {
                  lineValue:      lineVal,
                  // openingLine intentionally excluded — set once on first insert, never overwritten
                  overLine:       lineVal,
                  underLine:      underOutcome?.point?.toString() ?? lineVal,
                  overOdds:       overPrice,
                  underOdds:      underPrice,
                  holdPct:        holdPctStr,
                  noVigOverProb:  noVigOverProbStr,
                  noVigUnderProb: noVigUnderProbStr,
                  pulledAt: new Date(),
                },
              });
              processed++;
            }
          }
        }
      }
    } catch (e) {
      logger.error({ err: e, sport }, "External odds sync error");
    }
  }

  // Recalc prop scores so edge/action tags reflect new odds data.
  // Note: computeAllProjections is NOT called here — projections are derived from
  // game logs (updated nightly at 2am) and are unaffected by new odds data.
  // The projections cron (6am/11am/2pm) handles full projection refreshes.
  await recalcPropScores();
  return processed;
}

export async function recalcPropScores(): Promise<void> {
  const lines = await db
    .select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  // --- Personal bias correction ---
  // Load user setting + aggregate graded pick hit rates per statType×lineType.
  // Applied later in the per-line loop when biasCorrectionEnabled = true and
  // the bucket has >= 10 samples (too few samples → skip silently).
  let biasCorrectionEnabled = false;
  const biasMap = new Map<string, { hitRate: number; sampleSize: number }>();
  try {
    const [settings] = await db
      .select({ biasCorrectionEnabled: userSettingsTable.biasCorrectionEnabled })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, "default"))
      .limit(1);
    biasCorrectionEnabled = settings?.biasCorrectionEnabled ?? false;
    if (biasCorrectionEnabled) {
      const biasRows = await db
        .select({
          sport: playersTable.sport,
          statType: entryPicksTable.statType,
          lineType: entryPicksTable.lineType,
          hitCount: sql<number>`count(*) filter (where ${entryPicksTable.result} = 'hit')`,
          sampleSize: sql<number>`count(*)`,
        })
        .from(entryPicksTable)
        .leftJoin(playersTable, eq(entryPicksTable.playerId, playersTable.id))
        .where(inArray(entryPicksTable.result, ["hit", "miss"]))
        .groupBy(playersTable.sport, entryPicksTable.statType, entryPicksTable.lineType);
      for (const r of biasRows) {
        const n = Number(r.sampleSize);
        if (n >= 10) {
          const key = `${r.sport ?? ""}:${r.statType}:${r.lineType}`;
          biasMap.set(key, {
            hitRate: Number(r.hitCount) / n,
            sampleSize: n,
          });
        }
      }
    }
  } catch (e) {
    logger.warn({ err: e }, "recalcPropScores: bias map load failed — skipping bias correction");
  }

  // Scores are fully recomputed each run, so we clear and rebuild rather than
  // diffing per-row — see the batched delete+insert at the end.
  const activeIds = lines.map(r => r.line.id);
  if (activeIds.length === 0) {
    await db.delete(propScoresTable);
    return;
  }

  // --- Batch-load all related data upfront (eliminates N+1 queries) ---
  const uniquePlayerIds = [...new Set(lines.map(r => r.line.playerId))];
  const [allExtLines, allProjections, allGameLogs] = await Promise.all([
    db.select().from(externalLinesTable).where(inArray(externalLinesTable.ppLineId, activeIds)),
    db.select().from(ourProjectionsTable).where(
      inArray(ourProjectionsTable.playerId, uniquePlayerIds),
    ),
    db.select({
      playerId: playerGameLogsTable.playerId,
      statType: playerGameLogsTable.statType,
      value: playerGameLogsTable.value,
      gameDate: playerGameLogsTable.gameDate,
    }).from(playerGameLogsTable)
      .where(inArray(playerGameLogsTable.playerId, uniquePlayerIds))
      .orderBy(desc(playerGameLogsTable.gameDate)),
  ]);

  // Index game logs: "playerId:statType" → values[] (most recent first)
  const gameLogsByKey = new Map<string, number[]>();
  for (const gl of allGameLogs) {
    const key = `${gl.playerId}:${gl.statType}`;
    if (!gameLogsByKey.has(key)) gameLogsByKey.set(key, []);
    gameLogsByKey.get(key)!.push(Number(gl.value));
  }

  // Index for O(1) lookups
  const extLinesByPpLineId = new Map<number, typeof allExtLines>();
  for (const el of allExtLines) {
    if (el.ppLineId == null) continue;
    if (!extLinesByPpLineId.has(el.ppLineId)) extLinesByPpLineId.set(el.ppLineId, []);
    extLinesByPpLineId.get(el.ppLineId)!.push(el);
  }

  const projByPlayerStat = new Map<string, typeof allProjections[0]>();
  for (const p of allProjections) {
    projByPlayerStat.set(`${p.playerId}:${p.statType}`, p);
  }

  // Calibration table loaded once — used to temper each line's raw P(over).
  const calibrationMap = await loadCalibrationMap();

  // Standard sibling P(over) per player+stat — anchors the EV-fair payout-multiplier
  // estimate for that player's demon/goblin tiers. Uses the CALIBRATED pOver (the same
  // probability basis as pHit below) so the synthetic multiplier is EV-neutral against
  // our own model: a tier only out-scores standard when a REAL (manual) PrizePicks
  // multiplier beats fair value, never from a raw-vs-calibrated mismatch.
  const standardPOverByPlayerStat = new Map<string, number>();
  for (const { line, player } of lines) {
    if (line.lineType !== "standard") continue;
    const proj = projByPlayerStat.get(`${line.playerId}:${line.statType}`);
    if (!proj?.projectedValue || !proj?.stdDev) continue;
    const sLine = parseFloat((line.lineValueOverride ?? line.lineValue).toString());
    const sRaw = pOverLine(parseFloat(proj.projectedValue.toString()), parseFloat(proj.stdDev.toString()), sLine);
    const sCal = proj.sourceLabel && proj.sourceLabel !== "prior_only"
      ? calibratePOver(sRaw, player.sport, line.statType, line.lineType, calibrationMap).pOver
      : sRaw;
    standardPOverByPlayerStat.set(`${line.playerId}:${line.statType}`, sCal / 100);
  }

  // Active tier count per player+stat group — a "best value" recommendation is only
  // meaningful when there is an actual cross-tier choice (>1 active tier).
  const tierCountByGroup = new Map<string, Set<string>>();
  for (const { line } of lines) {
    const key = `${line.playerId}:${line.statType}`;
    (tierCountByGroup.get(key) ?? tierCountByGroup.set(key, new Set()).get(key)!).add(line.lineType);
  }

  // Best-value tier per player+stat group: the sibling with the highest expected
  // value (pHit × payout). Resolved in a second pass once every line's EV is known.
  // Ties (which is what EV-neutral synthetic multipliers produce) break toward the
  // lower-risk tier so we never crown a demon without a genuine payout edge.
  const TIER_RISK: Record<string, number> = { standard: 0, goblin: 1, demon: 2 };
  const EV_EPS = 0.005;
  const bestByGroup = new Map<string, { ppLineId: number; ev: number; lineType: string }>();

  // Computed scores are accumulated here, then written in one batched swap.
  const scorePayloads: (typeof propScoresTable.$inferInsert)[] = [];

  for (const { line, player } of lines) {
    try {
      // --- Market edge ---
      const extLines = extLinesByPpLineId.get(line.id) ?? [];
      let marketEdge = 0;
      let marketSupportScore = 50;
      let marketAvg: number | null = null;
      let bookCount = 0;

      if (extLines.length >= 1) {
        const vals = extLines
          .map(l => parseFloat((l.lineValue || l.overLine).toString()))
          .filter(v => !isNaN(v));
        if (vals.length >= 1) {
          bookCount = vals.length;
          marketAvg = vals.reduce((a, b) => a + b, 0) / vals.length;
          if (bookCount >= 2) {
            const ppLine = parseFloat(line.lineValue.toString());
            marketEdge = (-(ppLine - marketAvg) / marketAvg) * 100;
            marketSupportScore = Math.max(0, Math.min(100, 50 + marketEdge * 3));
          }
        }
      }

      // --- Projection data ---
      const proj = projByPlayerStat.get(`${line.playerId}:${line.statType}`) ?? null;

      const noPlayReason = proj?.noPlayReason ?? null;
      // Probability is tier-specific: evaluate the projection distribution against
      // THIS line's value. The stored proj.pOver was computed against one arbitrary
      // active line (.limit(1)) and is wrong for the other goblin/demon/standard tiers.
      const projMean = proj?.projectedValue ? parseFloat(proj.projectedValue.toString()) : null;
      const projStdDev = proj?.stdDev ? parseFloat(proj.stdDev.toString()) : null;
      const dataQualityScore = proj?.dataQualityScore ?? null;
      const confidence = proj?.confidence ?? null;
      const sourceLabel = proj?.sourceLabel ?? "prior_only";
      const ppLine = parseFloat(line.lineValue.toString());
      // Raw distribution probability for THIS line, then calibrated toward the
      // empirical bucket hit rate (skip prior-only — no real model signal).
      const pOverRaw = (projMean !== null && projStdDev !== null)
        ? pOverLine(projMean, projStdDev, ppLine)
        : null;
      const pOver = (pOverRaw !== null && sourceLabel !== "prior_only")
        ? calibratePOver(pOverRaw, player.sport, line.statType, line.lineType, calibrationMap).pOver
        : pOverRaw;

      // --- Cross-tier expected value ---
      // EV = P(hit of recommended side) × payout multiplier (standard = 1.0).
      // demon/goblin are over-side (MORE) constructs, so their boosted/reduced payout
      // applies to the over; standard lines take whichever side is more likely at 1.0.
      // Comparing EV across a player's tiers reveals when a demon/goblin's payout
      // outweighs its lower hit rate — i.e. the genuine best-value play.
      const stdPOver = standardPOverByPlayerStat.get(`${line.playerId}:${line.statType}`) ?? null;
      const payoutMult = effectivePayoutMultiplier(
        line.payoutMultiplier != null ? Number(line.payoutMultiplier) : null,
        line.lineType,
        pOver != null ? pOver / 100 : null,
        stdPOver,
      );
      // A tier may be crowned best-value only when its payout multiplier is
      // trustworthy: standard is exact (1.0); demon/goblin need either a real
      // manual override OR a standard sibling to anchor the EV-fair ratio. With
      // neither, the multiplier is an arbitrary tier default (demon 1.5 / goblin
      // 0.75) that structurally favors demon — so it must not win the ★ BEST badge.
      const multiplierTrustworthy =
        line.lineType === "standard" ||
        (line.payoutMultiplier != null && Number(line.payoutMultiplier) > 0) ||
        stdPOver != null;

      let recommendedSide: string | null = null;
      let pHit: number | null = null;
      let evValue: number | null = null;
      if (pOver !== null) {
        if (line.lineType === "demon" || line.lineType === "goblin") {
          recommendedSide = "over";
          pHit = pOver / 100;
          evValue = pHit * payoutMult;
        } else {
          recommendedSide = pOver >= 50 ? "over" : "under";
          pHit = recommendedSide === "over" ? pOver / 100 : 1 - pOver / 100;
          evValue = pHit * payoutMult;
        }
      }

      // --- Form factor: z-score of last 5 games vs historical mean/stddev ---
      // Positive z = hot streak, negative = cold. Contributes ±15 pts to edge.
      // Null when player has fewer than 5 logged games for this stat type.
      const formKey = `${line.playerId}:${line.statType}`;
      const formLogs = gameLogsByKey.get(formKey) ?? [];
      let formZScore: number | null = null;
      let formContribution = 0;
      if (formLogs.length >= 5) {
        const histMean = formLogs.reduce((a, b) => a + b, 0) / formLogs.length;
        const histVariance = formLogs.reduce((a, b) => a + (b - histMean) ** 2, 0) / formLogs.length;
        const histStd = Math.sqrt(histVariance);
        if (histStd >= 0.01) {
          const recentMean = formLogs.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
          const z = (recentMean - histMean) / histStd;
          formZScore = Math.round(z * 100) / 100;
          const zClamped = Math.max(-3, Math.min(3, z));
          formContribution = (zClamped / 3) * 15;
        }
      }

      // --- Gate 1: Edge Score ---
      const baseEdge =
        Math.max(0, (pOver !== null ? (pOver - 50) * 2 : 0)) * 0.6 +
        Math.max(0, (marketEdge / Math.max(ppLine, 0.1)) * 150) * 0.4;
      const rawEdge = Math.min(100, Math.max(0, baseEdge + formContribution));

      // Personal bias correction (optional, toggled per user setting).
      // When enabled and the personal bucket has ≥ 10 graded picks, apply a ±5
      // point adjustment proportional to (your hit rate − model pOver).
      let biasAdjustment = 0;
      let appliedBiasDelta: number | null = null;
      if (biasCorrectionEnabled) {
        const biasKey = `${player.sport ?? ""}:${line.statType}:${line.lineType}`;
        const bucket = biasMap.get(biasKey);
        if (bucket) {
          const modelProb = pOver != null ? pOver / 100 : 0.5;
          appliedBiasDelta = Math.round((bucket.hitRate - modelProb) * 1000) / 10;
          biasAdjustment = Math.max(-5, Math.min(5, (bucket.hitRate - modelProb) * 50));
        }
      }
      const edgeScore = Math.min(100, Math.max(0, rawEdge + biasAdjustment));

      // --- Gate 2: Stability Score ---
      const confidenceBonus =
        confidence === "high"   ? 20 :
        confidence === "medium" ? 10 : 0;
      const stabilityScore = Math.min(100, (dataQualityScore ?? 50) + confidenceBonus);

      // --- Gate 4: Risk Score ---
      const isGTD = noPlayReason === "game_time_decision";
      const stdDevNum = proj?.stdDev ? parseFloat(proj.stdDev.toString()) : 6;
      const volatilityRisk = Math.min(100, stdDevNum * 8);
      const riskScore = Math.round((isGTD ? 50 : 0) + (volatilityRisk * 0.50));

      // --- Final composite score ---
      const overallScore = Math.round(
        (edgeScore * 0.40) +
        (stabilityScore * 0.30) +
        (marketSupportScore * 0.20) +
        ((100 - riskScore) * 0.10),
      );

      // --- Action tag ---
      const hardNoPlay = noPlayReason != null;
      let actionTag: string;
      if (hardNoPlay) {
        actionTag = "NO-PLAY";
      } else if (overallScore >= 70 && edgeScore >= 55 && riskScore <= 45) {
        actionTag = "PLAY";
      } else if (overallScore >= 55 && edgeScore >= 40) {
        actionTag = "WATCH";
      } else if (overallScore < 55 || edgeScore < 20) {
        actionTag = "PASS";
      } else {
        actionTag = "WATCH";
      }

      // --- Reasoning blob ---
      const reasoning: Record<string, unknown> = {
        marketEdge: Math.round(marketEdge * 10) / 10,
        bookCount,
        marketAvg,
        ppLine,
        lineType: line.lineType,
        pOver,
        noPlayReason,
        dataQualityScore,
        confidence,
        sourceLabel,
        projectedValue: proj?.projectedValue ?? null,
        stdDev: proj?.stdDev ?? null,
        shrinkageFactor: proj?.shrinkageFactor ?? null,
        sport: player.sport,
        gateResults: {
          edge:      edgeScore      >= 60 ? "pass" : "fail",
          stability: stabilityScore >= 60 ? "pass" : "fail",
          market:    marketSupportScore >= 50 ? "pass" : "fail",
          risk:      riskScore      <= 45 ? "pass" : "fail",
        },
        reasonSummary:
          `E${Math.round(edgeScore)} S${Math.round(stabilityScore)} ` +
          `M${Math.round(marketSupportScore)} R${riskScore}`,
        biasDelta: appliedBiasDelta,
      };

      const scorePayload = {
        ppLineId:           line.id,
        playerId:           line.playerId,
        statType:           line.statType,
        marketSupportScore: marketSupportScore.toString(),
        edgeScore:          edgeScore.toString(),
        stabilityScore:     stabilityScore.toString(),
        riskScore:          riskScore.toString(),
        finalScore:         overallScore.toString(),
        actionTag,
        evValue:            evValue != null ? evValue.toFixed(4) : null,
        recommendedSide,
        bestTierInGroup:    false, // resolved in the second pass below
        reasoning,
        formZScore:         formZScore != null ? String(formZScore) : null,
        scoredAt:           new Date(),
      };

      scorePayloads.push(scorePayload);

      // Track the highest-EV tier per player+stat group (skip NO-PLAY lines so a
      // gated line never wins). Floating EVs are compared by value, not equality.
      if (evValue != null && actionTag !== "NO-PLAY" && multiplierTrustworthy) {
        const groupKey = `${line.playerId}:${line.statType}`;
        const cur = bestByGroup.get(groupKey);
        // Strictly higher EV wins; within EV_EPS it's a tie, so keep the lower-risk
        // tier (standard < goblin < demon) — never crown a riskier tier on noise.
        const better = !cur
          || evValue > cur.ev + EV_EPS
          || (Math.abs(evValue - cur.ev) <= EV_EPS
              && (TIER_RISK[line.lineType] ?? 1) < (TIER_RISK[cur.lineType] ?? 1));
        if (better) bestByGroup.set(groupKey, { ppLineId: line.id, ev: evValue, lineType: line.lineType });
      }

      void player;
    } catch (e) {
      logger.error({ err: e, lineId: line.id }, "Prop score calc error");
    }
  }

  // Second pass: flag each group's highest-EV tier as the recommended best value —
  // but only when the group has a real cross-tier choice (>1 active tier). A lone
  // standard line is trivially "best" and the badge would be meaningless noise.
  for (const payload of scorePayloads) {
    const groupKey = `${payload.playerId}:${payload.statType}`;
    if ((tierCountByGroup.get(groupKey)?.size ?? 0) < 2) continue;
    const best = bestByGroup.get(groupKey);
    if (best && best.ppLineId === payload.ppLineId) payload.bestTierInGroup = true;
  }

  // Atomically swap in the freshly computed scores: clear all, then batch-insert.
  // Chunked to stay well under Postgres' parameter limit on large slates.
  await db.transaction(async (tx) => {
    await tx.delete(propScoresTable);
    for (let i = 0; i < scorePayloads.length; i += 500) {
      await tx.insert(propScoresTable).values(scorePayloads.slice(i, i + 500));
    }
  });
}
