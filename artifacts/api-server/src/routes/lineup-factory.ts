import { Router } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, playersTable, propScoresTable, ourProjectionsTable,
  varianceScoresTable, externalLinesTable, syncRunsTable,
} from "@workspace/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();

// ─── Payout tables ────────────────────────────────────────────────────────────
const POWER_MULT: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };
const FLEX_MULT: Record<string, number> = {
  "2/2": 3,
  "3/3": 5, "2/3": 1.25,
  "4/4": 10, "3/4": 2.5,
  "5/5": 20, "4/5": 4, "3/5": 1,
  "6/6": 40, "5/6": 6, "4/6": 1.5,
};

// ─── Config schema ────────────────────────────────────────────────────────────
const configSchema = z.object({
  format: z.enum(["power", "flex", "stack", "team_plus_player"]),
  picksPerEntry: z.number().int().min(2).max(6),
  numEntries: z.number().int().min(1).max(25),
  varianceProfile: z.enum(["conservative", "balanced", "aggressive", "chaos", "custom"]),
  optimizationObjective: z.enum(["max_ev", "max_profit_prob", "min_drawdown", "balanced_growth", "high_ceiling"]),
  maxPlayerExposure: z.number().min(0).max(1),
  maxPickExposure: z.number().min(0).max(1),
  maxTeamExposure: z.number().min(0).max(1),
  maxGameExposure: z.number().min(0).max(1),
  maxPairwiseOverlap: z.number().min(0).max(1),
  stakePerEntry: z.number().positive(),
  totalBudget: z.number().positive().optional(),
  minEdgeThreshold: z.number().optional(),
  minProbabilityThreshold: z.number().optional(),
  allowGtdPlayers: z.boolean(),
  allowSingleBookData: z.boolean(),
  allowStaleMarketData: z.boolean(),
  demonUnderAllowed: z.boolean(),
  sport: z.string().optional(),
});

type FactoryConfig = z.infer<typeof configSchema>;

type ScoredProp = {
  ppLineId: number;
  playerId: number;
  playerName: string;
  imageUrl: string | null;
  team: string;
  teamId: number | null;
  gameId: number | null;
  sport: string;
  statType: string;
  direction: "more" | "less";
  lineType: string;
  ppLine: number;
  hitProbability: number;
  probabilitySource: string;
  confidence: string;
  expectedValue: number;
  edgeScore: number | null;
  riskScore: number | null;
  volatilityRating: string | null;
  marketDataStatus: string;
  bookCount: number;
  noPlayReason: string | null;
  reasonCodes: string[];
  compositeScore: number;
};

type GeneratedLineup = {
  id: number;
  picks: ScoredProp[];
  format: string;
  picksPerEntry: number;
  ev: number;
  hitProbability: number;
  grossPayout: number;
  stake: number;
  correlationAdjusted: boolean;
  correlationNote: string | null;
  diversificationScore: number;
};

// ─── Math helpers ─────────────────────────────────────────────────────────────

function getFlexMultiplier(hits: number, total: number): number {
  return FLEX_MULT[`${hits}/${total}`] ?? 0;
}

function calcFlexEV(probs: number[], stake: number): number {
  const n = probs.length;
  let ev = -stake;
  for (let mask = 0; mask < (1 << n); mask++) {
    let stateProb = 1;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) { stateProb *= probs[i]; hits++; }
      else { stateProb *= (1 - probs[i]); }
    }
    const mult = getFlexMultiplier(hits, n);
    if (mult > 0) ev += stateProb * mult * stake;
  }
  return ev;
}

function calcCorrelationFactor(picks: ScoredProp[]): number {
  let factor = 1.0;
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const a = picks[i], b = picks[j];
      if (a.playerId === b.playerId) {
        factor *= 1.10;
      } else if (a.gameId && b.gameId && a.gameId === b.gameId && a.direction === b.direction) {
        factor *= 1.03;
      }
    }
  }
  return Math.min(factor, 1.30);
}

function calcPowerEV(picks: ScoredProp[], stake: number, n: number) {
  const mult = POWER_MULT[n] ?? 10;
  const rawPHit = picks.reduce((acc, p) => acc * p.hitProbability, 1);
  const corrFactor = calcCorrelationFactor(picks);
  const pHit = Math.min(0.97, Math.max(0.005, rawPHit * corrFactor));
  return { ev: pHit * mult * stake - stake, pHit, corrFactor };
}

function pairwiseOverlap(a: ScoredProp[], b: ScoredProp[]): number {
  const aIds = new Set(a.map(p => p.ppLineId));
  let shared = 0;
  for (const p of b) if (aIds.has(p.ppLineId)) shared++;
  return shared / Math.max(a.length, b.length, 1);
}

function calcCompositeScore(prop: ScoredProp, objective: string): number {
  const { expectedValue: ev, hitProbability: prob, edgeScore, volatilityRating, lineType } = prop;
  const edge = edgeScore ?? 0;
  switch (objective) {
    case "max_ev":          return ev + edge * 0.05;
    case "max_profit_prob": return prob * 100;
    case "min_drawdown":    return prob * 100 - (volatilityRating === "high" ? 15 : volatilityRating === "medium" ? 5 : 0);
    case "balanced_growth": return ev * 0.5 + prob * 50;
    case "high_ceiling":    return ev * (lineType === "demon" ? 1.5 : 1.0);
    default:                return ev;
  }
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  let s = (seed ^ 0x5a4f3d2e) >>> 0;
  for (let i = copy.length - 1; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = (s ^ (s >>> 16)) >>> 0;
    const j = s % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function applyProfile(cfg: FactoryConfig): FactoryConfig {
  const c = { ...cfg };
  switch (cfg.varianceProfile) {
    case "conservative":
      c.maxPlayerExposure       = Math.min(cfg.maxPlayerExposure, 0.40);
      c.maxPickExposure         = Math.min(cfg.maxPickExposure, 0.40);
      c.maxPairwiseOverlap      = Math.min(cfg.maxPairwiseOverlap, 0.34);
      c.minProbabilityThreshold = Math.max(cfg.minProbabilityThreshold ?? 0, 0.52);
      c.allowGtdPlayers         = false;
      break;
    case "balanced":
      c.minProbabilityThreshold = Math.max(cfg.minProbabilityThreshold ?? 0, 0.48);
      break;
    case "aggressive":
      c.minProbabilityThreshold = cfg.minProbabilityThreshold ?? 0.42;
      break;
    case "chaos":
      c.minProbabilityThreshold = cfg.minProbabilityThreshold ?? 0.35;
      break;
  }
  return c;
}

function monteCarloPortfolio(lineups: GeneratedLineup[], totalStake: number, iterations = 4000) {
  let breakEven = 0, profitable = 0;
  for (let i = 0; i < iterations; i++) {
    let payout = 0;
    for (const lu of lineups) {
      if (Math.random() < lu.hitProbability) payout += lu.grossPayout;
    }
    if (payout >= totalStake) breakEven++;
    if (payout > totalStake) profitable++;
  }
  return { probBreakEven: breakEven / iterations, probProfitable: profitable / iterations };
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/lineup-factory/generate", async (req, res) => {
  try {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: "Invalid config", details: parsed.error.flatten() });
    }
    const cfg = applyProfile(parsed.data);

    // ── 1. Bulk query all active player lines ──────────────────────────────
    const rows = await db
      .select({
        line: ppLinesTable,
        player: playersTable,
        score: propScoresTable,
        proj: ourProjectionsTable,
        variance: varianceScoresTable,
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
      .leftJoin(varianceScoresTable, eq(varianceScoresTable.ppLineId, ppLinesTable.id))
      .where(and(eq(ppLinesTable.isActive, true), eq(ppLinesTable.pickCategory, "player")));

    // ── 2. Bulk query external lines (avoids N+1) ──────────────────────────
    const ppLineIds = rows.map(r => r.line.id);
    const allExtLines = ppLineIds.length
      ? await db.select().from(externalLinesTable).where(inArray(externalLinesTable.ppLineId, ppLineIds))
      : [];

    const extByLineId = new Map<number, typeof allExtLines>();
    for (const el of allExtLines) {
      if (!el.ppLineId) continue;
      if (!extByLineId.has(el.ppLineId)) extByLineId.set(el.ppLineId, []);
      extByLineId.get(el.ppLineId)!.push(el);
    }

    // ── 3. Market data freshness ───────────────────────────────────────────
    const [lastOddsRun] = await db
      .select()
      .from(syncRunsTable)
      .where(eq(syncRunsTable.jobName, "external-odds"))
      .orderBy(desc(syncRunsTable.finishedAt))
      .limit(1);
    const oddsAgeMinutes = lastOddsRun?.finishedAt
      ? (Date.now() - lastOddsRun.finishedAt.getTime()) / 60000
      : Infinity;

    // ── 4. Score every prop ────────────────────────────────────────────────
    const allScoredProps: ScoredProp[] = [];

    for (const row of rows) {
      if (cfg.sport && row.player.sport !== cfg.sport) continue;

      const extLines = extByLineId.get(row.line.id) ?? [];
      const bookLines: Record<string, number> = {};
      for (const el of extLines) {
        const val = el.lineValue ?? el.overLine;
        if (val) bookLines[el.bookName] = parseFloat(val.toString());
      }
      const bookVals = Object.values(bookLines);
      const bookCount = bookVals.length;
      const marketAvg = bookCount ? bookVals.reduce((a, b) => a + b, 0) / bookCount : null;
      const ppLine = parseFloat(row.line.lineValue.toString());
      const trueEdge = marketAvg ? (-(ppLine - marketAvg) / marketAvg) * 100 : null;

      let marketDataStatus: string;
      if (bookCount >= 2) {
        marketDataStatus = oddsAgeMinutes <= 30 ? "available" : oddsAgeMinutes <= 60 ? "partial" : "unavailable";
      } else if (bookCount === 1) {
        marketDataStatus = "partial";
      } else {
        marketDataStatus = lastOddsRun ? "unavailable" : "not_synced";
      }

      // ── Hit probability ──
      const pOver = row.proj?.pOver ? parseFloat(row.proj.pOver.toString()) / 100 : null;
      let hitProbability: number;
      let probabilitySource: string;
      let confidence: string;

      if (pOver !== null && marketDataStatus === "available" && marketAvg && trueEdge !== null) {
        const marketImplied = Math.max(0.05, Math.min(0.95, 0.5 + trueEdge / 200));
        hitProbability = pOver * 0.60 + marketImplied * 0.40;
        probabilitySource = "combined";
        confidence = (row.proj?.confidence === "high" && bookCount >= 3) ? "high" : "medium";
      } else if (pOver !== null) {
        hitProbability = pOver;
        probabilitySource = "projection";
        confidence = row.proj?.confidence ?? "medium";
      } else if (trueEdge !== null) {
        hitProbability = Math.max(0.05, Math.min(0.95, 0.5 + trueEdge / 200));
        probabilitySource = "market";
        confidence = bookCount >= 3 ? "medium" : "low";
      } else {
        hitProbability = row.line.lineType === "goblin" ? 0.62 : row.line.lineType === "demon" ? 0.38 : 0.50;
        probabilitySource = "line_type";
        confidence = "low";
      }

      // Apply variance EV modifier
      if (row.variance?.evModifier) {
        const mod = parseFloat(row.variance.evModifier.toString());
        hitProbability = Math.min(0.97, Math.max(0.05, hitProbability * (1 + mod / 100)));
      }

      // Line-type adjustments
      if (row.line.lineType === "goblin") hitProbability = Math.min(0.97, hitProbability * 1.08);
      if (row.line.lineType === "demon")  hitProbability = Math.max(0.05, hitProbability * 0.92);

      // Direction
      const direction: "more" | "less" =
        (row.line.lineType === "demon" && cfg.demonUnderAllowed) ? "less" : "more";

      // EV (single-prop contribution for sorting)
      const stake = cfg.stakePerEntry;
      const expectedValue = cfg.format === "flex"
        ? calcFlexEV([hitProbability], stake)
        : hitProbability * (POWER_MULT[cfg.picksPerEntry] ?? 10) * stake - stake;

      const edgeScore = row.score
        ? parseFloat((row.score.finalScore ?? "0").toString())
        : (trueEdge !== null ? Math.round(trueEdge * 10) / 10 : null);
      const riskScore = row.score
        ? parseFloat((row.score.riskScore ?? "0").toString())
        : null;

      // Reason codes
      const reasonCodes: string[] = [];
      let noPlayReason: string | null = null;
      if (row.score?.actionTag === "NO-PLAY" || row.proj?.noPlayReason) {
        noPlayReason = row.proj?.noPlayReason ?? "scored_no_play";
        reasonCodes.push("no_play");
      }
      if (row.player.status === "out")         { noPlayReason = "player_out"; reasonCodes.push("player_out"); }
      if (row.player.status === "gtd" || row.player.status === "questionable") reasonCodes.push("gtd_player");
      if (marketDataStatus === "unavailable")  reasonCodes.push("stale_market_data");
      if (marketDataStatus === "not_synced")   reasonCodes.push("no_market_data");
      if (bookCount === 1)                     reasonCodes.push("single_book");
      if (probabilitySource === "line_type")   reasonCodes.push("no_projection");
      const vr = row.variance?.volatilityRating;
      if (vr === "high")                       reasonCodes.push("high_volatility");
      if (row.variance?.blowoutRisk && parseFloat(row.variance.blowoutRisk.toString()) > 0.7)
        reasonCodes.push("high_blowout_risk");

      allScoredProps.push({
        ppLineId:          row.line.id,
        playerId:          row.player.id,
        playerName:        row.player.fullName,
        imageUrl:          row.player.imageUrl ?? null,
        team:              String(row.player.teamId ?? ""),
        teamId:            row.player.teamId ?? null,
        gameId:            row.line.gameId ?? null,
        sport:             row.player.sport,
        statType:          row.line.statType,
        direction,
        lineType:          row.line.lineType,
        ppLine,
        hitProbability:    Math.round(hitProbability * 1000) / 1000,
        probabilitySource,
        confidence,
        expectedValue:     Math.round(expectedValue * 100) / 100,
        edgeScore:         edgeScore !== null ? Math.round(edgeScore * 10) / 10 : null,
        riskScore:         riskScore !== null ? Math.round(riskScore * 10) / 10 : null,
        volatilityRating:  vr ?? null,
        marketDataStatus,
        bookCount,
        noPlayReason,
        reasonCodes,
        compositeScore:    0, // set below
      });
    }

    // Assign composite scores
    for (const sp of allScoredProps) {
      sp.compositeScore = Math.round(calcCompositeScore(sp, cfg.optimizationObjective) * 100) / 100;
    }

    const eligiblePropCount = allScoredProps.length;

    // ── 5. Filter by config ────────────────────────────────────────────────
    const eligible = allScoredProps.filter(p => {
      if (p.noPlayReason === "player_out") return false;
      if (!cfg.allowGtdPlayers && p.reasonCodes.includes("gtd_player")) return false;
      if (!cfg.allowStaleMarketData && p.marketDataStatus === "unavailable") return false;
      if (!cfg.allowSingleBookData && p.marketDataStatus === "partial") return false;
      if (cfg.minProbabilityThreshold && p.hitProbability < cfg.minProbabilityThreshold) return false;
      if (cfg.minEdgeThreshold !== undefined && (p.edgeScore ?? -Infinity) < cfg.minEdgeThreshold) return false;
      if (p.lineType === "demon" && !cfg.demonUnderAllowed && p.direction === "less") return false;
      return true;
    });

    eligible.sort((a, b) => b.compositeScore - a.compositeScore);
    const filteredPropCount = eligible.length;

    // ── 6. Generate lineups ────────────────────────────────────────────────
    const lineups: GeneratedLineup[] = [];
    const n = cfg.picksPerEntry;

    for (let luIdx = 0; luIdx < cfg.numEntries; luIdx++) {
      // Exposure tracking across all generated lineups so far
      const playerCounts: Record<number, number> = {};
      const pickCounts:   Record<number, number> = {};
      const teamCounts:   Record<number, number> = {};
      const gameCounts:   Record<number, number> = {};
      for (const lu of lineups) {
        for (const p of lu.picks) {
          playerCounts[p.playerId] = (playerCounts[p.playerId] ?? 0) + 1;
          pickCounts[p.ppLineId]   = (pickCounts[p.ppLineId] ?? 0) + 1;
          if (p.teamId) teamCounts[p.teamId] = (teamCounts[p.teamId] ?? 0) + 1;
          if (p.gameId) gameCounts[p.gameId] = (gameCounts[p.gameId] ?? 0) + 1;
        }
      }

      // Pool selection with profile-based randomization
      let pool: ScoredProp[];
      const seed = luIdx * 7919 + 31337;
      if (cfg.varianceProfile === "chaos") {
        pool = seededShuffle(eligible, seed);
      } else if (cfg.varianceProfile === "aggressive") {
        const top = Math.max(n, Math.ceil(eligible.length * 0.70));
        pool = seededShuffle(eligible.slice(0, top), seed);
      } else if (cfg.varianceProfile === "balanced") {
        const top = Math.max(n, Math.ceil(eligible.length * 0.60));
        pool = seededShuffle(eligible.slice(0, top), seed);
      } else {
        const top = Math.max(n, Math.ceil(eligible.length * 0.50));
        pool = seededShuffle(eligible.slice(0, top), seed + luIdx);
      }

      const picks: ScoredProp[] = [];
      const totalFuture = cfg.numEntries;

      for (const candidate of pool) {
        if (picks.length >= n) break;
        if (picks.some(p => p.ppLineId === candidate.ppLineId)) continue;

        const afterPlayer = (playerCounts[candidate.playerId] ?? 0) + 1;
        if (afterPlayer / totalFuture > cfg.maxPlayerExposure + 0.001) continue;

        const afterPick = (pickCounts[candidate.ppLineId] ?? 0) + 1;
        if (afterPick / totalFuture > cfg.maxPickExposure + 0.001) continue;

        if (candidate.teamId) {
          const afterTeam = (teamCounts[candidate.teamId] ?? 0) + 1;
          if (afterTeam / totalFuture > cfg.maxTeamExposure + 0.001) continue;
        }
        if (candidate.gameId) {
          const afterGame = (gameCounts[candidate.gameId] ?? 0) + 1;
          if (afterGame / totalFuture > cfg.maxGameExposure + 0.001) continue;
        }

        // Pairwise overlap check with already-built lineups
        let tooMuchOverlap = false;
        for (const existing of lineups) {
          if (pairwiseOverlap([...picks, candidate], existing.picks) > cfg.maxPairwiseOverlap + 0.001) {
            tooMuchOverlap = true;
            break;
          }
        }
        if (tooMuchOverlap) continue;

        picks.push(candidate);
      }

      // Relaxed fallback: drop overlap constraint to fill lineup
      if (picks.length < n) {
        for (const candidate of pool) {
          if (picks.length >= n) break;
          if (picks.some(p => p.ppLineId === candidate.ppLineId)) continue;
          if (picks.some(p => p.playerId === candidate.playerId && p.statType === candidate.statType)) continue;
          picks.push(candidate);
        }
      }

      if (picks.length < 2) continue;

      const stake = cfg.stakePerEntry;
      let ev: number, pHit: number, grossPayout: number;
      let correlationAdjusted = false;
      let correlationNote: string | null = null;

      if (cfg.format === "flex") {
        ev = calcFlexEV(picks.map(p => p.hitProbability), stake);
        pHit = picks.reduce((acc, p) => acc * p.hitProbability, 1);
        grossPayout = (getFlexMultiplier(picks.length, picks.length) || 1) * stake;
        correlationAdjusted = picks.some((p, i) => picks.slice(i + 1).some(q => q.playerId === p.playerId));
      } else {
        const result = calcPowerEV(picks, stake, picks.length);
        ev = result.ev;
        pHit = result.pHit;
        grossPayout = (POWER_MULT[picks.length] ?? 10) * stake;
        correlationAdjusted = result.corrFactor !== 1.0;
        if (result.corrFactor > 1.01) {
          correlationNote = `Positive correlation detected (+${((result.corrFactor - 1) * 100).toFixed(1)}% joint-prob). Estimate is approximate.`;
        }
      }

      const diversificationScore = lineups.length > 0
        ? Math.round((1 - lineups.reduce((acc, lu) => acc + pairwiseOverlap(picks, lu.picks), 0) / lineups.length) * 100) / 100
        : 1.0;

      lineups.push({
        id:                  luIdx + 1,
        picks,
        format:              cfg.format,
        picksPerEntry:       picks.length,
        ev:                  Math.round(ev * 100) / 100,
        hitProbability:      Math.round(pHit * 1000) / 1000,
        grossPayout,
        stake,
        correlationAdjusted,
        correlationNote,
        diversificationScore,
      });
    }

    // ── 7. Portfolio analytics ────────────────────────────────────────────
    const totalStake = lineups.length * cfg.stakePerEntry;
    const portfolioEV = lineups.reduce((acc, lu) => acc + lu.ev, 0);
    const pNoneCash = lineups.reduce((acc, lu) => acc * (1 - lu.hitProbability), 1);
    const probAtLeastOneCashes = 1 - pNoneCash;
    const maxPayout = lineups.reduce((acc, lu) => acc + lu.grossPayout, 0);
    const { probBreakEven, probProfitable } = monteCarloPortfolio(lineups, totalStake);

    const playerExposure: Record<string, number> = {};
    const pickExposure: Record<string, number> = {};
    const teamExposure: Record<string, number> = {};
    for (const lu of lineups) {
      const seen = new Set<number>();
      for (const p of lu.picks) {
        if (!seen.has(p.ppLineId)) {
          seen.add(p.ppLineId);
          playerExposure[p.playerName] = (playerExposure[p.playerName] ?? 0) + 1;
          pickExposure[`${p.playerName} — ${p.statType}`] = (pickExposure[`${p.playerName} — ${p.statType}`] ?? 0) + 1;
          if (p.teamId) teamExposure[String(p.teamId)] = (teamExposure[String(p.teamId)] ?? 0) + 1;
        }
      }
    }
    const lc = lineups.length || 1;
    for (const k of Object.keys(playerExposure)) playerExposure[k] = Math.round((playerExposure[k] / lc) * 1000) / 1000;
    for (const k of Object.keys(pickExposure))   pickExposure[k]   = Math.round((pickExposure[k] / lc) * 1000) / 1000;
    for (const k of Object.keys(teamExposure))   teamExposure[k]   = Math.round((teamExposure[k] / lc) * 1000) / 1000;

    const topPicksByExposure = Object.entries(pickExposure)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, exposure]) => ({ name, exposure }));

    let totalPairwiseOverlap = 0, pairCount = 0;
    for (let i = 0; i < lineups.length; i++) {
      for (let j = i + 1; j < lineups.length; j++) {
        totalPairwiseOverlap += pairwiseOverlap(lineups[i].picks, lineups[j].picks);
        pairCount++;
      }
    }
    const avgPairwiseOverlap = pairCount > 0 ? Math.round((totalPairwiseOverlap / pairCount) * 1000) / 1000 : 0;

    res.json({
      lineups,
      portfolioStats: {
        totalStake:              Math.round(totalStake * 100) / 100,
        portfolioEV:             Math.round(portfolioEV * 100) / 100,
        probAtLeastOneCashes:    Math.round(probAtLeastOneCashes * 1000) / 1000,
        probBreakEven:           Math.round(probBreakEven * 1000) / 1000,
        probProfitable:          Math.round(probProfitable * 1000) / 1000,
        worstCaseLoss:           -totalStake,
        maxPayout:               Math.round(maxPayout * 100) / 100,
        avgPairwiseOverlap,
        playerExposure,
        pickExposure,
        teamExposure,
        topPicksByExposure,
      },
      scoredProps:       allScoredProps.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 200),
      eligiblePropCount,
      filteredPropCount,
      generationConfig:  cfg,
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
