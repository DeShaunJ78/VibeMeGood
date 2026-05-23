import { db } from "@workspace/db";
import {
  externalLinesTable, ppLinesTable, playersTable, propScoresTable, lineMoveEventsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";

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
    logger.warn("ODDS_API_KEY not set — skipping external odds sync");
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
            for (const outcome of (market.outcomes || [])) {
              if (outcome.type !== "Over") continue;
              const playerName = outcome.description || outcome.name;
              if (!playerName || !outcome.point) continue;

              const match = lines.find(l => {
                const ppLast = l.player.fullName.split(" ").pop()?.toLowerCase() || "";
                const mktLast = playerName.split(" ").pop()?.toLowerCase() || "";
                return ppLast === mktLast || l.player.fullName.toLowerCase() === playerName.toLowerCase();
              });
              if (!match) continue;

              const lineVal = outcome.point.toString();

              // Check for existing and record move event if changed
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

              // Upsert external line
              await db.insert(externalLinesTable).values({
                playerId: match.player.id,
                ppLineId: match.line.id,
                statType: match.line.statType,
                bookName: bookmaker.key,
                lineValue: lineVal,
                overLine: lineVal,
                underLine: lineVal,
                pulledAt: new Date(),
              }).onConflictDoUpdate({
                target: [externalLinesTable.ppLineId, externalLinesTable.bookName],
                set: {
                  lineValue: lineVal,
                  overLine: lineVal,
                  underLine: lineVal,
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

  // Recalculate prop scores after odds update
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
      const extLines = await db.select()
        .from(externalLinesTable)
        .where(eq(externalLinesTable.ppLineId, line.id));

      let edgeScore = 0;
      let marketSupportScore = 50;
      let trueEdge: number | null = null;

      if (extLines.length >= 2) {
        const vals = extLines
          .map(l => parseFloat((l.lineValue || l.overLine).toString()))
          .filter(v => !isNaN(v));
        if (vals.length >= 2) {
          const marketAvg = vals.reduce((a, b) => a + b, 0) / vals.length;
          const ppLine = parseFloat(line.lineValue.toString());
          trueEdge = (-( ppLine - marketAvg) / marketAvg) * 100;
          edgeScore = trueEdge;
          marketSupportScore = Math.max(0, Math.min(100, 50 + trueEdge * 3));
        }
      }

      const lineBonus = line.lineType === "goblin" ? 12 : line.lineType === "demon" ? -12 : 0;
      const finalScore = edgeScore + lineBonus;
      const actionTag = finalScore >= 5 ? "PLAY" : finalScore <= -4 ? "PASS" : "WATCH";

      // Upsert prop score — check existing first since no unique constraint yet
      const [existingScore] = await db.select()
        .from(propScoresTable)
        .where(eq(propScoresTable.ppLineId, line.id))
        .limit(1);

      const scorePayload = {
        ppLineId: line.id,
        playerId: line.playerId,
        statType: line.statType,
        marketSupportScore: marketSupportScore.toString(),
        edgeScore: edgeScore.toString(),
        stabilityScore: "50",
        riskScore: line.lineType === "demon" ? "70" : "30",
        finalScore: finalScore.toString(),
        actionTag,
        scoredAt: new Date(),
      };

      if (existingScore) {
        await db.update(propScoresTable)
          .set({
            marketSupportScore: scorePayload.marketSupportScore,
            edgeScore: scorePayload.edgeScore,
            finalScore: scorePayload.finalScore,
            actionTag,
            scoredAt: new Date(),
          })
          .where(eq(propScoresTable.id, existingScore.id));
      } else {
        await db.insert(propScoresTable).values(scorePayload);
      }

      void player;
      void trueEdge;
    } catch (e) {
      logger.error({ err: e, lineId: line.id }, "Prop score calc error");
    }
  }
}
