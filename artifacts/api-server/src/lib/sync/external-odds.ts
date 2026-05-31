import { db } from "@workspace/db";
import {
  externalLinesTable, ppLinesTable, playersTable, propScoresTable,
  lineMoveEventsTable, ourProjectionsTable, dataPullLogsTable,
} from "@workspace/db/schema";
import { eq, and, notInArray, desc, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { twoWayHold, noVigProbs } from "../analytics/odds-math";

const ODDS_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const ODDS_KEY = process.env.ODDS_API_KEY || "";

const SPORT_KEYS: Record<string, string> = {
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  NFL: "americanfootball_nfl",
  WNBA: "basketball_wnba",
};

const STAT_MARKETS: Record<string, string> = {
  Points: "player_points",
  Rebounds: "player_rebounds",
  Assists: "player_assists",
  "3-Pointers Made": "player_threes",
  "Pts+Reb+Ast": "player_points_rebounds_assists",
  "Pts+Rebs": "player_points_rebounds",
  "Pts+Asts": "player_points_assists",
  "Total Bases": "player_total_bases",
  Hits: "player_hits",
  Strikeouts: "pitcher_strikeouts",
};

/** Minimum ms between successful external-odds syncs (normal cron path). */
const MIN_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
/**
 * Floor for FORCED (pre-lock) syncs. force still skips the normal 20-min guard
 * for urgency, but never refetches faster than this — protects paid Odds API
 * credits if /sync/pre-lock is hit repeatedly. 5 min is well inside any
 * pre-lock window so freshness is unaffected.
 */
const FORCE_FLOOR_MS = 5 * 60 * 1000; // 5 minutes

/** In-flight guard: concurrent callers join the same run instead of double-fetching. */
let inFlight: Promise<number> | null = null;

/**
 * @param force - skip the 20-min cooldown for urgency (pre-lock only). Still
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
  // Normal path: 20 min. Forced (pre-lock) path: 5 min floor. Either way a
  // skip falls back to recalcing scores from existing data (no API spend).
  const floorMs = force ? FORCE_FLOOR_MS : MIN_INTERVAL_MS;
  {
    const [lastSuccess] = await db
      .select({ finishedAt: dataPullLogsTable.finishedAt })
      .from(dataPullLogsTable)
      .where(and(
        eq(dataPullLogsTable.jobName, "external-odds"),
        eq(dataPullLogsTable.status, "success"),
      ))
      .orderBy(desc(dataPullLogsTable.startedAt))
      .limit(1);

    if (lastSuccess?.finishedAt &&
        Date.now() - lastSuccess.finishedAt.getTime() < floorMs) {
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

    const neededMarkets = new Set(
      lines.map(l => STAT_MARKETS[l.line.statType]).filter(Boolean),
    );
    if (!neededMarkets.size) continue;

    try {
      // --- BATCH: one call returns all events with odds (vs one call per event) ---
      // This is the key credit saver: 1 API request vs up to 15.
      const marketsParam = [...neededMarkets].join(",");
      const batchRes = await fetch(
        `${ODDS_BASE}/sports/${sportKey}/odds?` +
        `apiKey=${ODDS_KEY}&regions=us&markets=${marketsParam}&oddsFormat=american`,
      );

      if (!batchRes.ok) {
        logger.warn({ sport, status: batchRes.status }, "external-odds batch fetch failed");
        continue;
      }

      // Log remaining credits from response headers
      const remaining = batchRes.headers.get("x-requests-remaining");
      const used = batchRes.headers.get("x-requests-used");
      if (remaining !== null) {
        logger.info({ sport, remaining, used }, "Odds API credits");
      }

      const events = await batchRes.json() as any[];

      for (const event of events) {
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

              const statType = Object.entries(STAT_MARKETS).find(
                ([, v]) => v === market.key
              )?.[0];

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
                playerId:      match.player.id,
                ppLineId:      match.line.id,
                statType:      match.line.statType,
                bookName:      bookmaker.key,
                lineValue:     lineVal,
                overLine:      lineVal,
                underLine:     underOutcome?.point?.toString() ?? lineVal,
                overOdds:      overPrice,
                underOdds:     underPrice,
                holdPct:       holdPctStr,
                noVigOverProb:  noVigOverProbStr,
                noVigUnderProb: noVigUnderProbStr,
                pulledAt: new Date(),
              }).onConflictDoUpdate({
                target: [externalLinesTable.ppLineId, externalLinesTable.bookName],
                set: {
                  lineValue:      lineVal,
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

  // Remove stale prop_scores for lines that are no longer active.
  const activeIds = lines.map(r => r.line.id);
  if (activeIds.length > 0) {
    await db.delete(propScoresTable)
      .where(notInArray(propScoresTable.ppLineId, activeIds));
  } else {
    await db.delete(propScoresTable);
    return;
  }

  // --- Batch-load all related data upfront (eliminates N+1 queries) ---
  const [allExtLines, allProjections, allExistingScores] = await Promise.all([
    db.select().from(externalLinesTable).where(inArray(externalLinesTable.ppLineId, activeIds)),
    db.select().from(ourProjectionsTable).where(
      inArray(ourProjectionsTable.playerId, [...new Set(lines.map(r => r.line.playerId))]),
    ),
    db.select({ id: propScoresTable.id, ppLineId: propScoresTable.ppLineId })
      .from(propScoresTable)
      .where(inArray(propScoresTable.ppLineId, activeIds)),
  ]);

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

  const existingScoreByLineId = new Map<number, number>();
  for (const s of allExistingScores) {
    existingScoreByLineId.set(s.ppLineId, s.id);
  }

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
      const pOver = proj?.pOver ? parseFloat(proj.pOver.toString()) : null;
      const dataQualityScore = proj?.dataQualityScore ?? null;
      const confidence = proj?.confidence ?? null;
      const sourceLabel = proj?.sourceLabel ?? "prior_only";
      const ppLine = parseFloat(line.lineValue.toString());

      // --- Gate 1: Edge Score ---
      const edgeScore = Math.min(100,
        Math.max(0, (pOver !== null ? (pOver - 50) * 2 : 0)) * 0.6 +
        Math.max(0, (marketEdge / Math.max(ppLine, 0.1)) * 150) * 0.4,
      );

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
        reasoning,
        scoredAt:           new Date(),
      };

      const existingId = existingScoreByLineId.get(line.id);
      if (existingId) {
        await db.update(propScoresTable)
          .set({
            marketSupportScore: scorePayload.marketSupportScore,
            edgeScore:          scorePayload.edgeScore,
            stabilityScore:     scorePayload.stabilityScore,
            finalScore:         scorePayload.finalScore,
            actionTag,
            reasoning,
            scoredAt: new Date(),
          })
          .where(eq(propScoresTable.id, existingId));
      } else {
        await db.insert(propScoresTable).values(scorePayload);
      }

      void player;
    } catch (e) {
      logger.error({ err: e, lineId: line.id }, "Prop score calc error");
    }
  }
}
