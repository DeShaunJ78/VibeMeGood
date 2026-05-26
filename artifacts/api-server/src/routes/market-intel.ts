import { Router } from "express";
import Decimal from "decimal.js";
import { db } from "@workspace/db";
import {
  ppLinesTable, externalLinesTable, propScoresTable, playersTable,
  ourProjectionsTable, playerStreaksTable, lineMoveEventsTable, syncRunsTable,
  varianceScoresTable, platformLinesTable, playerGameLogsTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, desc, gte, asc, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { consensusFairProb, edgePct, holdWarning } from "../lib/analytics/odds-math";
import { detectSharpMoney } from "../lib/propedge/sharp-detector";

const router = Router();

router.get("/market-intel", async (req, res) => {
  try {
    const {
      sport, actionTag, lineType, minEdgeScore,
      page = "1", limit = "100",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset = (pageNum - 1) * limitNum;

    const freshnessCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const baseConditions: ReturnType<typeof eq>[] = [
      eq(ppLinesTable.isActive, true),
      or(
        isNull(ppLinesTable.lastSyncedAt),
        gte(ppLinesTable.lastSyncedAt, freshnessCutoff),
      ) as ReturnType<typeof eq>,
    ];

    if (sport) baseConditions.push(eq(playersTable.sport, sport));
    if (lineType) baseConditions.push(eq(ppLinesTable.lineType, lineType));
    if (actionTag) baseConditions.push(eq(propScoresTable.actionTag, actionTag));
    if (minEdgeScore) {
      const edgeNum = parseFloat(minEdgeScore);
      if (!isNaN(edgeNum)) {
        baseConditions.push(
          gte(sql`COALESCE(${propScoresTable.finalScore}::numeric, 0)`, String(edgeNum)) as ReturnType<typeof eq>,
        );
      }
    }

    const whereClause = and(...baseConditions);

    const baseQuery = () => db
      .select({
        line: ppLinesTable,
        player: playersTable,
        score: propScoresTable,
        proj: ourProjectionsTable,
        streak: playerStreaksTable,
      })
      .from(ppLinesTable)
      .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
      .leftJoin(propScoresTable, eq(propScoresTable.ppLineId, ppLinesTable.id))
      .leftJoin(
        ourProjectionsTable,
        and(
          eq(ourProjectionsTable.playerId, ppLinesTable.playerId),
          eq(ourProjectionsTable.statType, ppLinesTable.statType),
        ),
      )
      .leftJoin(
        playerStreaksTable,
        and(
          eq(playerStreaksTable.playerId, ppLinesTable.playerId),
          eq(playerStreaksTable.statType, ppLinesTable.statType),
        ),
      );

    const [countResult, rows, lastOddsRun] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)` })
        .from(ppLinesTable)
        .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
        .leftJoin(propScoresTable, eq(propScoresTable.ppLineId, ppLinesTable.id))
        .leftJoin(ourProjectionsTable, and(
          eq(ourProjectionsTable.playerId, ppLinesTable.playerId),
          eq(ourProjectionsTable.statType, ppLinesTable.statType),
        ))
        .where(whereClause),

      baseQuery()
        .where(whereClause)
        .orderBy(
          asc(sql`CASE WHEN ${propScoresTable.actionTag} = 'NO-PLAY' THEN 1 ELSE 0 END`),
          desc(sql`${propScoresTable.finalScore}::numeric`),
        )
        .limit(limitNum)
        .offset(offset),

      db
        .select()
        .from(syncRunsTable)
        .where(eq(syncRunsTable.jobName, "external-odds"))
        .orderBy(desc(syncRunsTable.finishedAt))
        .limit(1)
        .then(r => r[0]),
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    const ppLineIds = rows.map(r => r.line.id);
    const uniquePlayerIds = [...new Set(rows.map(r => r.line.playerId))];
    const uniquePlayerNames = [...new Set(rows.map(r => r.player.fullName))];

    const [allExtLines, allVarScores, allRecentMoves, allPlatformLines, allGameLogs] = ppLineIds.length
      ? await Promise.all([
          db
            .select()
            .from(externalLinesTable)
            .where(
              or(
                inArray(externalLinesTable.ppLineId, ppLineIds),
                and(
                  isNull(externalLinesTable.ppLineId),
                  inArray(
                    externalLinesTable.playerId,
                    rows.map(r => r.line.playerId),
                  ),
                ),
              ),
            ),

          db
            .select({
              ppLineId: varianceScoresTable.ppLineId,
              volatilityRating: varianceScoresTable.volatilityRating,
              blowoutRisk: varianceScoresTable.blowoutRisk,
              fatigueScore: varianceScoresTable.fatigueScore,
              usageScore: varianceScoresTable.usageScore,
              matchupScore: varianceScoresTable.matchupScore,
              environmentScore: varianceScoresTable.environmentScore,
              warnings: varianceScoresTable.warnings,
              evModifier: varianceScoresTable.evModifier,
              whyItMoves: varianceScoresTable.whyItMoves,
            })
            .from(varianceScoresTable)
            .where(inArray(varianceScoresTable.ppLineId, ppLineIds)),

          db
            .select()
            .from(lineMoveEventsTable)
            .where(inArray(lineMoveEventsTable.ppLineId, ppLineIds))
            .orderBy(desc(lineMoveEventsTable.capturedAt)),

          uniquePlayerNames.length
            ? db
                .select()
                .from(platformLinesTable)
                .where(inArray(platformLinesTable.playerName, uniquePlayerNames))
            : Promise.resolve([] as (typeof platformLinesTable.$inferSelect)[]),

          uniquePlayerIds.length
            ? db
                .select({
                  playerId:       playerGameLogsTable.playerId,
                  statType:       playerGameLogsTable.statType,
                  value:          playerGameLogsTable.value,
                  gameDate:       playerGameLogsTable.gameDate,
                })
                .from(playerGameLogsTable)
                .where(inArray(playerGameLogsTable.playerId, uniquePlayerIds))
                .orderBy(desc(playerGameLogsTable.gameDate))
            : Promise.resolve([] as { playerId: number; statType: string; value: string; gameDate: Date }[]),
        ])
      : [[], [], [], [], []];

    const extLinesByPpLineId = new Map<number, typeof allExtLines>();
    for (const l of allExtLines) {
      const id = l.ppLineId ?? -1;
      if (!extLinesByPpLineId.has(id)) extLinesByPpLineId.set(id, []);
      extLinesByPpLineId.get(id)!.push(l);

      if (l.ppLineId === null) {
        for (const row of rows) {
          if (row.line.playerId === l.playerId && row.line.statType === l.statType) {
            const rid = row.line.id;
            if (!extLinesByPpLineId.has(rid)) extLinesByPpLineId.set(rid, []);
            extLinesByPpLineId.get(rid)!.push(l);
          }
        }
      }
    }

    const varScoreByPpLineId = new Map(allVarScores.map(v => [v.ppLineId!, v]));

    const recentMovesByPpLineId = new Map<number, typeof allRecentMoves>();
    const allMovesByPpLineId    = new Map<number, typeof allRecentMoves>();
    for (const m of allRecentMoves) {
      if (m.ppLineId === null) continue;
      if (!recentMovesByPpLineId.has(m.ppLineId)) recentMovesByPpLineId.set(m.ppLineId, []);
      if (!allMovesByPpLineId.has(m.ppLineId))    allMovesByPpLineId.set(m.ppLineId, []);
      const arr = recentMovesByPpLineId.get(m.ppLineId)!;
      if (arr.length < 5) arr.push(m);
      allMovesByPpLineId.get(m.ppLineId)!.push(m);
    }

    // Platform lines map: lowercase(playerName):lowercase(statType) → {platform → lineValue}
    const platformLinesByKey = new Map<string, Map<string, number>>();
    for (const pl of allPlatformLines) {
      const key = `${pl.playerName.toLowerCase()}:${pl.statType.toLowerCase()}`;
      if (!platformLinesByKey.has(key)) platformLinesByKey.set(key, new Map());
      platformLinesByKey.get(key)!.set(pl.platform, Number(pl.lineValue));
    }

    // Game logs map: playerId:statType → values[] (most recent first)
    type GameLogEntry = { value: number; };
    const gameLogsByKey = new Map<string, GameLogEntry[]>();
    for (const gl of allGameLogs) {
      const key = `${gl.playerId}:${gl.statType.toLowerCase()}`;
      if (!gameLogsByKey.has(key)) gameLogsByKey.set(key, []);
      gameLogsByKey.get(key)!.push({ value: Number(gl.value) });
    }

    const result = rows.map(row => {
      const extLines    = extLinesByPpLineId.get(row.line.id) ?? [];
      const varScore    = varScoreByPpLineId.get(row.line.id) ?? null;
      const recentMoves = recentMovesByPpLineId.get(row.line.id) ?? [];
      const allMoves    = allMovesByPpLineId.get(row.line.id) ?? [];
      const sharpResult = allMoves.length >= 2 ? detectSharpMoney(allMoves) : null;

      const bookLines: Record<string, number> = {};
      for (const l of extLines) {
        const val = l.lineValue || l.overLine;
        if (val) bookLines[l.bookName] = parseFloat(val.toString());
      }
      // Also include pick'em platform lines (Underdog, etc.) in the book comparison
      const platKey = `${row.player.fullName.toLowerCase()}:${row.line.statType.toLowerCase()}`;
      const platLines = platformLinesByKey.get(platKey);
      if (platLines) {
        for (const [platform, lineVal] of platLines) {
          bookLines[platform] = lineVal;
        }
      }

      const vals = Object.values(bookLines);
      const marketAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const ppLine = parseFloat(row.line.lineValue.toString());

      const noVigDecimalProbs: Decimal[] = extLines
        .filter(l => l.noVigOverProb !== null)
        .map(l => new Decimal(l.noVigOverProb!.toString()));
      const fairProbDecimal = consensusFairProb(noVigDecimalProbs);

      const projPOver = row.proj?.pOver ? parseFloat(row.proj.pOver.toString()) : null;
      const modelProbDecimal = projPOver != null ? new Decimal(projPOver).div(100) : null;

      let trueEdge: number | null = null;
      if (fairProbDecimal && modelProbDecimal) {
        trueEdge = edgePct(modelProbDecimal, fairProbDecimal).times(100).toDecimalPlaces(2).toNumber();
      } else if (marketAvg) {
        trueEdge = Math.round((-(ppLine - marketAvg) / marketAvg) * 1000) / 10;
      }

      const holdValues = extLines
        .filter(l => l.holdPct !== null)
        .map(l => new Decimal(l.holdPct!.toString()));
      const avgHoldDecimal = holdValues.length
        ? holdValues.reduce((a, b) => a.plus(b), new Decimal(0)).div(holdValues.length)
        : null;

      const marketHoldPct = avgHoldDecimal
        ? avgHoldDecimal.times(100).toDecimalPlaces(2).toNumber()
        : null;
      const holdRating = avgHoldDecimal ? holdWarning(avgHoldDecimal) : null;

      const bookHolds = extLines
        .filter(l => l.holdPct !== null)
        .map(l => ({
          book:       l.bookName,
          holdPct:    new Decimal(l.holdPct!.toString()).times(100).toDecimalPlaces(2).toNumber(),
          overPrice:  l.overOdds  ?? null,
          underPrice: l.underOdds ?? null,
        }));

      const fairProb = fairProbDecimal
        ? fairProbDecimal.times(100).toDecimalPlaces(2).toNumber()
        : null;

      let marketDataStatus: "available" | "partial" | "unavailable" | "not_synced";
      if (vals.length >= 2) {
        const ageMins = lastOddsRun?.finishedAt
          ? (Date.now() - lastOddsRun.finishedAt.getTime()) / 60000
          : Infinity;
        marketDataStatus = ageMins <= 30 ? "available" : ageMins <= 60 ? "partial" : "unavailable";
      } else if (vals.length === 1) {
        marketDataStatus = "partial";
      } else if (lastOddsRun) {
        marketDataStatus = "unavailable";
      } else {
        marketDataStatus = "not_synced";
      }

      const proj = row.proj;
      const noPlayReason = proj?.noPlayReason ?? null;
      const pOver = proj?.pOver ? parseFloat(proj.pOver.toString()) : null;
      const dqScore = proj?.dataQualityScore ?? null;
      const isStale = proj?.expiresAt ? new Date() > proj.expiresAt : false;
      const effectiveNoPlay = noPlayReason ?? (isStale ? "stale_projection" : null);
      const sourceLabel = isStale
        ? `${proj?.sourceLabel ?? "prior_only"} (stale)`
        : (proj?.sourceLabel ?? null);

      const scoreReasoning = (row.score?.reasoning as Record<string, unknown> | null) ?? null;

      // FIX 3 — Convergence signal: compare model pOver vs historical hit rate
      const glKey = `${row.line.playerId}:${row.line.statType.toLowerCase()}`;
      const gameLogs = gameLogsByKey.get(glKey) ?? [];
      const last30 = gameLogs.slice(0, 30);
      const histHits = last30.filter(g => g.value > ppLine).length;
      const histRate = last30.length >= 5 ? (histHits / last30.length) * 100 : null;

      let convergenceSignal: {
        direction: "over" | "under" | "diverging";
        strength: "green" | "amber";
        histRate: number;
        modelRate: number;
        message: string;
      } | null = null;

      if (histRate !== null && pOver !== null) {
        const diff = Math.abs(pOver - histRate);
        if (pOver >= 55 && histRate >= 55) {
          convergenceSignal = {
            direction: "over", strength: "green", histRate, modelRate: pOver,
            message: `Model (${pOver.toFixed(1)}%) & history (${histRate.toFixed(1)}%) both favor OVER`,
          };
        } else if (pOver < 45 && histRate < 45) {
          convergenceSignal = {
            direction: "under", strength: "green", histRate, modelRate: pOver,
            message: `Model (${pOver.toFixed(1)}%) & history (${histRate.toFixed(1)}%) both favor UNDER`,
          };
        } else if (diff > 8) {
          convergenceSignal = {
            direction: "diverging", strength: "amber", histRate, modelRate: pOver,
            message: `Model (${pOver.toFixed(1)}%) and history (${histRate.toFixed(1)}%) disagree by ${diff.toFixed(1)}%`,
          };
        }
      }

      // FIX 4 — Dynamic streak: compute from game logs when player_streaks table is sparse
      let streakData: { count: number; type: string | null } | null = row.streak
        ? { count: Math.abs(row.streak.currentStreak ?? 0), type: row.streak.streakType }
        : null;

      if (!streakData && gameLogs.length >= 2) {
        const firstVal = gameLogs[0].value;
        const firstIsOver = firstVal > ppLine;
        let streakCount = 1;
        for (let i = 1; i < gameLogs.length; i++) {
          const isOver = gameLogs[i].value > ppLine;
          if (isOver === firstIsOver) streakCount++;
          else break;
        }
        if (streakCount >= 2) {
          streakData = { count: streakCount, type: firstIsOver ? "over" : "under" };
        }
      }

      return {
        ppLineId: row.line.id,
        playerId: row.player.id,
        playerName: row.player.fullName,
        imageUrl: row.player.imageUrl ?? null,
        teamId: row.player.teamId,
        sport: row.player.sport,
        statType: row.line.statType,
        lineValue: ppLine,
        lineType: row.line.lineType,

        marketAvg: marketAvg ? Math.round(marketAvg * 100) / 100 : null,
        trueEdge,
        bookLines,
        marketDataStatus,
        bookCount: vals.length,
        fairProb,
        marketHoldPct,
        holdRating,
        bookHolds,

        edgeScore: marketDataStatus !== "not_synced" && row.score
          ? parseFloat(row.score.finalScore?.toString() || "0")
          : null,
        actionTag: row.score?.actionTag ?? null,

        ourProjection: proj ? {
          value: parseFloat(proj.projectedValue.toString()),
          stdDev: proj.stdDev ? parseFloat(proj.stdDev.toString()) : null,
          pOver,
          percentileAtLine: proj.percentileAtLine ? parseFloat(proj.percentileAtLine.toString()) : null,
          noPlayReason: effectiveNoPlay,
          dataQualityScore: dqScore,
          sourceLabel,
          confidence: proj.confidence,
          gamesUsed: proj.gamesUsed,
          shrinkageFactor: proj.shrinkageFactor ? parseFloat(proj.shrinkageFactor.toString()) : null,
          isStale,
        } : null,

        streak: streakData,
        convergenceSignals: convergenceSignal,

        recentMoves: recentMoves.map(m => ({
          book: m.bookName,
          from: m.prevLine,
          to: m.newLine,
          direction: m.moveDirection,
          at: m.capturedAt,
        })),

        sharpSignal:      sharpResult?.signal      ?? null,
        sharpConfidence:  sharpResult?.confidence  ?? null,
        sharpExplanation: sharpResult?.explanation ?? null,
        sharpSide:        sharpResult?.sharpSide   ?? null,
        sharpPublicPct:   sharpResult?.estimatedPublicPct ?? null,

        scoring: scoreReasoning,

        variance: varScore ? {
          volatilityRating: varScore.volatilityRating,
          blowoutRisk: varScore.blowoutRisk,
          fatigueScore: varScore.fatigueScore,
          usageScore: varScore.usageScore,
          matchupScore: varScore.matchupScore,
          environmentScore: varScore.environmentScore,
          warnings: varScore.warnings as string[] | null,
          evModifier: varScore.evModifier,
          whyItMoves: varScore.whyItMoves,
        } : null,
      };
    });

    res.json({
      data: result,
      total,
      page: pageNum,
      limit: limitNum,
      hasMore: offset + limitNum < total,
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
