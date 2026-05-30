import { Router } from "express";
import Decimal from "decimal.js";
import { db } from "@workspace/db";
import {
  ppLinesTable, externalLinesTable, propScoresTable, playersTable,
  ourProjectionsTable, playerStreaksTable, lineMoveEventsTable, syncRunsTable,
  varianceScoresTable, platformLinesTable, playerGameLogsTable,
  probabilityCalibrationTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, isNotNull, desc, gte, asc, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { consensusFairProb, edgePct, holdWarning } from "../lib/analytics/odds-math";
import { detectSharpMoney } from "../lib/propedge/sharp-detector";

// ROOT ISSUE 1 — helpers for base-stat and combo projection fallback
function getBaseStatType(statType: string): string {
  if (/point/i.test(statType) && !statType.includes("+")) return "Points";
  if (/rebound/i.test(statType) && !statType.includes("+")) return "Rebounds";
  if (/assist/i.test(statType) && !statType.includes("+")) return "Assists";
  if (/steal/i.test(statType)) return "Steals";
  if (/block/i.test(statType)) return "Blocks";
  if (/three|3-pt|3pt/i.test(statType)) return "3-Pointers Made";
  if (/free throw/i.test(statType)) return "Free Throws Made";
  if (/turnover/i.test(statType)) return "Turnovers";
  return statType;
}

type FallbackProj = { projectedValue: number; pOver: number | null; stdDev: number | null };

function getComboProjection(
  statType: string,
  playerMap: Map<string, FallbackProj>,
): number | null {
  const g = (k: string) => playerMap.get(k)?.projectedValue ?? null;
  const s = statType.toLowerCase();
  if (/pts\+rebs?\+asts?/i.test(s) || /points\+rebounds\+assists/i.test(s)) {
    const pts = g("points"), reb = g("rebounds"), ast = g("assists");
    return pts != null && reb != null && ast != null ? pts + reb + ast : null;
  }
  if (/pts\+asts?/i.test(s) || /points\+assists/i.test(s)) {
    const pts = g("points"), ast = g("assists");
    return pts != null && ast != null ? pts + ast : null;
  }
  if (/pts\+rebs?/i.test(s) || /points\+rebounds/i.test(s)) {
    const pts = g("points"), reb = g("rebounds");
    return pts != null && reb != null ? pts + reb : null;
  }
  if (/rebs?\+asts?/i.test(s) || /rebounds\+assists/i.test(s)) {
    const reb = g("rebounds"), ast = g("assists");
    return reb != null && ast != null ? reb + ast : null;
  }
  if (/hits?\+runs?\+rbi/i.test(s)) {
    const h = g("hits"), r = g("runs"), rbi = g("rbis") ?? g("rbi");
    return h != null && r != null && rbi != null ? h + r + rbi : null;
  }
  return null;
}

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

    if (sport) {
      const sportsToMatch =
        sport === "NFL"  ? ["NFL", "NFLSZN"] :
        sport === "NBA"  ? ["NBA", "NBA1Q", "NBA1H", "NBA1P"] :
        sport === "MLB"  ? ["MLB", "MLBLIVE"] :
        sport === "NHL"  ? ["NHL", "NHL1P"] :
        sport === "WNBA" ? ["WNBA", "WNBA1H"] :
        [sport];
      baseConditions.push(inArray(playersTable.sport, sportsToMatch));
    }
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

    const [countResult, rows, lastOddsRun, allCalibCounts] = await Promise.all([
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
        .where(and(
          eq(syncRunsTable.jobName, "external-odds"),
          isNotNull(syncRunsTable.finishedAt),
        ))
        .orderBy(desc(syncRunsTable.finishedAt))
        .limit(1)
        .then(r => r[0]),

      db
        .select({
          sport:        probabilityCalibrationTable.sport,
          statType:     probabilityCalibrationTable.statType,
          totalSamples: sql<number>`COALESCE(SUM(${probabilityCalibrationTable.sampleSize}), 0)::int`,
        })
        .from(probabilityCalibrationTable)
        .groupBy(probabilityCalibrationTable.sport, probabilityCalibrationTable.statType),
    ]);

    const total = Number(countResult[0]?.total ?? 0);

    // Build calibration count lookup: "sport:statType" → total samples
    const calibMap = new Map<string, number>();
    for (const c of allCalibCounts) {
      calibMap.set(`${c.sport.toLowerCase()}:${c.statType.toLowerCase()}`, c.totalSamples);
    }

    const ppLineIds = rows.map(r => r.line.id);
    const uniquePlayerIds = [...new Set(rows.map(r => r.line.playerId))];
    const uniquePlayerNames = [...new Set(rows.map(r => r.player.fullName))];

    const [allExtLines, allVarScores, allRecentMoves, allPlatformLines, allGameLogs, allPlayerProjections] = ppLineIds.length
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

          // ROOT ISSUE 1 — fetch all projections for all players (for base/combo fallback)
          uniquePlayerIds.length
            ? db
                .select({
                  playerId:       ourProjectionsTable.playerId,
                  statType:       ourProjectionsTable.statType,
                  projectedValue: ourProjectionsTable.projectedValue,
                  pOver:          ourProjectionsTable.pOver,
                  stdDev:         ourProjectionsTable.stdDev,
                })
                .from(ourProjectionsTable)
                .where(inArray(ourProjectionsTable.playerId, uniquePlayerIds))
            : Promise.resolve([] as { playerId: number; statType: string; projectedValue: string; pOver: string | null; stdDev: string | null }[]),
        ])
      : [[], [], [], [], [], []];

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

    // ROOT ISSUE 1 — build per-player projection maps for base/combo fallback
    const playerProjectionMaps = new Map<number, Map<string, FallbackProj>>();
    for (const p of allPlayerProjections) {
      if (p.playerId == null) continue;
      const pid = p.playerId;
      if (!playerProjectionMaps.has(pid)) {
        playerProjectionMaps.set(pid, new Map());
      }
      playerProjectionMaps.get(pid)!.set(p.statType.toLowerCase(), {
        projectedValue: Number(p.projectedValue),
        pOver:          p.pOver  ? Number(p.pOver)  : null,
        stdDev:         p.stdDev ? Number(p.stdDev) : null,
      });
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

      // ROOT ISSUE 1 — projPOver uses fallback pOver when exact join misses
      // (playerProjMap / fallback not yet computed here; use row.proj directly — fallback handled below)
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

      // ROOT ISSUE 1 — override for combo/base stat types with real calculated values
      // DB `ourProjections` has prior_only rows (value=20) for every statType including combos.
      // For combo stat types (e.g. "Pts+Rebs"), prefer the sum of base stat projections.
      // For base-stat mismatches, use the matching base type when the exact join missed.
      const playerProjMap = playerProjectionMaps.get(row.line.playerId);
      const isComboType = row.line.statType.includes("+");
      let fallback: FallbackProj | null = null;
      if (playerProjMap) {
        if (isComboType) {
          // Always prefer computed sum for combos — it beats a 20.0 prior
          const comboVal = getComboProjection(row.line.statType, playerProjMap);
          if (comboVal != null) fallback = { projectedValue: comboVal, pOver: null, stdDev: null };
        }
        if (!proj && !fallback) {
          // Exact join missed: try base stat type
          const baseType = getBaseStatType(row.line.statType);
          fallback = playerProjMap.get(baseType.toLowerCase()) ?? null;
        }
      }

      // For combos with a computed fallback, suppress the inaccurate prior-only DB row
      const effectiveProj = (isComboType && fallback) ? null : proj;

      const noPlayReason = effectiveProj?.noPlayReason ?? null;
      const pOver = effectiveProj?.pOver
        ? parseFloat(effectiveProj.pOver.toString())
        : (fallback?.pOver ?? null);
      const dqScore = effectiveProj?.dataQualityScore ?? null;
      const isStale = effectiveProj?.expiresAt ? new Date() > effectiveProj.expiresAt : false;
      const effectiveNoPlay = noPlayReason ?? (isStale ? "stale_projection" : null);
      const sourceLabel = isStale
        ? `${effectiveProj?.sourceLabel ?? "prior_only"} (stale)`
        : (effectiveProj?.sourceLabel ?? (fallback ? "base_fallback" : null));

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
        // Fix 7: minimum 3 consecutive games to show a streak badge.
        // A 2-game streak is noise and should not be surfaced.
        if (streakCount >= 3) {
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
        // Fix 11: downgrade PLAY → WATCH when calibrationCount < 30.
        // A PLAY tag requires both model confidence AND calibration validation.
        actionTag: (() => {
          const tag = row.score?.actionTag ?? null;
          const calibCount = calibMap.get(`${row.player.sport.toLowerCase()}:${row.line.statType.toLowerCase()}`) ?? 0;
          if (tag === "PLAY" && calibCount < 30) return "WATCH";
          return tag;
        })(),

        ourProjection: (effectiveProj || fallback) ? {
          value: effectiveProj
            ? parseFloat(effectiveProj.projectedValue.toString())
            : fallback!.projectedValue,
          stdDev: effectiveProj?.stdDev
            ? parseFloat(effectiveProj.stdDev.toString())
            : (fallback?.stdDev ?? null),
          p99: effectiveProj?.p99 ? parseFloat(effectiveProj.p99.toString()) : null,
          pOver,
          percentileAtLine: effectiveProj?.percentileAtLine ? parseFloat(effectiveProj.percentileAtLine.toString()) : null,
          noPlayReason: effectiveNoPlay,
          dataQualityScore: dqScore,
          sourceLabel,
          confidence: effectiveProj?.confidence ?? null,
          gamesUsed: effectiveProj?.gamesUsed ?? null,
          shrinkageFactor: effectiveProj?.shrinkageFactor ? parseFloat(effectiveProj.shrinkageFactor.toString()) : null,
          isStale,
          vor: effectiveProj?.vor != null ? parseFloat(effectiveProj.vor.toString()) : null,
          ensembleBlendPct: (effectiveProj?.ensembleBlendPct ?? 0) as 0 | 30 | 70,
          calSampleSize: calibMap.get(`${row.player.sport.toLowerCase()}:${row.line.statType.toLowerCase()}`) ?? 0,
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

        calibrationCount: calibMap.get(`${row.player.sport.toLowerCase()}:${row.line.statType.toLowerCase()}`) ?? 0,

        gameLogs: gameLogs.slice(0, 10).map(g => g.value),

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
      lastOddsSync: lastOddsRun?.finishedAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
