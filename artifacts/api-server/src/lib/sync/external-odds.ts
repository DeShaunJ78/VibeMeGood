import { db } from "@workspace/db";
import {
  externalLinesTable, ppLinesTable, playersTable, propScoresTable,
  lineMoveEventsTable, ourProjectionsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import { twoWayHold, noVigProbs } from "../analytics/odds-math";
import { computeAllProjections } from "../projection/compute";
import { computeStreaks } from "./streaks";

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
  "Total Bases": "player_total_bases",
  Hits: "player_hits",
  Strikeouts: "pitcher_strikeouts",
};

export async function syncExternalOdds(): Promise<number> {
  if (!ODDS_KEY) {
    logger.warn("ODDS_API_KEY not set — running projection engine only");
    await computeAllProjections();
    await recalcPropScores();
    await computeStreaks();
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

    try {
      const eventsRes = await fetch(
        `${ODDS_BASE}/sports/${sportKey}/events?apiKey=${ODDS_KEY}`,
      );
      if (!eventsRes.ok) continue;
      const events = await eventsRes.json() as any[];

      const neededMarkets = new Set(
        lines.map(l => STAT_MARKETS[l.line.statType]).filter(Boolean),
      );
      if (!neededMarkets.size) continue;

      for (const event of (events as any[]).slice(0, 15)) {
        const oddsRes = await fetch(
          `${ODDS_BASE}/sports/${sportKey}/events/${event.id}/odds?` +
          `apiKey=${ODDS_KEY}&regions=us&markets=${[...neededMarkets].join(",")}&oddsFormat=american`,
        );
        if (!oddsRes.ok) continue;
        const oddsData = await oddsRes.json() as any;

        for (const bookmaker of (oddsData.bookmakers || [])) {
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

              const match = lines.find(l => {
                const ppLast  = l.player.fullName.split(" ").pop()?.toLowerCase() || "";
                const mktLast = playerName.split(" ").pop()?.toLowerCase() || "";
                return ppLast === mktLast || l.player.fullName.toLowerCase() === playerName.toLowerCase();
              });
              if (!match) continue;

              const lineVal    = overOutcome.point.toString();
              const overPrice  = overOutcome.price  != null ? Number(overOutcome.price)  : null;
              const underPrice = underOutcome?.price != null ? Number(underOutcome.price) : null;

              // Compute hold and no-vig when both prices available
              let holdPctStr:       string | null = null;
              let noVigOverProbStr: string | null = null;
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
        await new Promise(r => setTimeout(r, 150));
      }
    } catch (e) {
      logger.error({ err: e, sport }, "External odds sync error");
    }
  }

  // Run projection engine first so prop scores can factor in pOver + noPlayReason
  await computeAllProjections();
  await recalcPropScores();
  return processed;
}

export async function recalcPropScores(): Promise<void> {
  const lines = await db
    .select({ line: ppLinesTable, player: playersTable })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  for (const { line, player } of lines) {
    try {
      // --- Market edge ---
      const extLines = await db.select()
        .from(externalLinesTable)
        .where(eq(externalLinesTable.ppLineId, line.id));

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
          // Fix 9: require ≥ 2 books before letting market data influence the score.
          // A single book could be stale or an outlier — keep marketSupportScore neutral (50).
          if (bookCount >= 2) {
            const ppLine = parseFloat(line.lineValue.toString());
            marketEdge = (-(ppLine - marketAvg) / marketAvg) * 100;
            marketSupportScore = Math.max(0, Math.min(100, 50 + marketEdge * 3));
          }
        }
      }

      // --- Projection data ---
      const [proj] = await db.select()
        .from(ourProjectionsTable)
        .where(and(
          eq(ourProjectionsTable.playerId, line.playerId),
          eq(ourProjectionsTable.statType, line.statType),
        ))
        .limit(1);

      const noPlayReason = proj?.noPlayReason ?? null;
      const pOver = proj?.pOver ? parseFloat(proj.pOver.toString()) : null;
      const dataQualityScore = proj?.dataQualityScore ?? null;
      const confidence = proj?.confidence ?? null;
      const sourceLabel = proj?.sourceLabel ?? "prior_only";
      const ppLine = parseFloat(line.lineValue.toString());

      // --- Gate 1: Edge Score (pOver + market gap) ---
      const edgeScore = Math.min(100,
        Math.max(0, (pOver !== null ? (pOver - 50) * 2 : 0)) * 0.6 +
        Math.max(0, (marketEdge / Math.max(ppLine, 0.1)) * 150) * 0.4,
      );

      // --- Gate 2: Stability Score (data quality + confidence bonus) ---
      const confidenceBonus =
        confidence === "high"   ? 20 :
        confidence === "medium" ? 10 : 0;
      const stabilityScore = Math.min(100, (dataQualityScore ?? 50) + confidenceBonus);

      // marketSupportScore unchanged from above

      // --- Gate 4: Risk Score (GTD flag + volatility from stdDev) ---
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
      // Fix 1: insufficient_data (prior-only, 0 game logs) is now a hard NO-PLAY.
      // Prior-only projections must never receive PLAY or WATCH tags.
      const hardNoPlay = noPlayReason != null;
      let actionTag: string;
      if (hardNoPlay) {
        actionTag = "NO-PLAY";
      } else if (overallScore >= 75 && edgeScore >= 60 && riskScore <= 45) {
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
        ppLineId: line.id,
        playerId: line.playerId,
        statType: line.statType,
        marketSupportScore: marketSupportScore.toString(),
        edgeScore: edgeScore.toString(),
        stabilityScore: stabilityScore.toString(),
        riskScore: riskScore.toString(),
        finalScore: overallScore.toString(),
        actionTag,
        reasoning,
        scoredAt: new Date(),
      };

      const [existingScore] = await db.select()
        .from(propScoresTable)
        .where(eq(propScoresTable.ppLineId, line.id))
        .limit(1);

      if (existingScore) {
        await db.update(propScoresTable)
          .set({
            marketSupportScore: scorePayload.marketSupportScore,
            edgeScore: scorePayload.edgeScore,
            stabilityScore: scorePayload.stabilityScore,
            finalScore: scorePayload.finalScore,
            actionTag,
            reasoning,
            scoredAt: new Date(),
          })
          .where(eq(propScoresTable.id, existingScore.id));
      } else {
        await db.insert(propScoresTable).values(scorePayload);
      }

      void player;
    } catch (e) {
      logger.error({ err: e, lineId: line.id }, "Prop score calc error");
    }
  }
}
