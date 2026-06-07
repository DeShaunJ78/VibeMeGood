import { Router } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, playersTable, propScoresTable, ourProjectionsTable,
  varianceScoresTable, externalLinesTable, syncRunsTable,
  entryPicksTable, entriesTable, gameEnvironmentTable, lineMoveEventsTable,
  teamPaceRatingsTable, teamsTable, crowdOwnershipTable,
} from "@workspace/db/schema";
import { eq, and, inArray, desc, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { pOverLine } from "../lib/projection/normal-dist";
import { effectivePayoutMultiplier } from "../lib/payout/multiplier";
import { z } from "zod";

const router = Router();

// ─── Payout tables ────────────────────────────────────────────────────────────
const POWER_MULT: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };
const FLEX_MULT: Record<string, number> = {
  "2/2": 3,
  "3/3": 5, "2/3": 1.25,
  "4/4": 10, "3/4": 2.5,
  "5/5": 20, "4/5": 4, "3/5": 1,
  "6/6": 40, "5/6": 6, "4/6": 1.5, "3/6": 1,
};

// ─── Config schema ────────────────────────────────────────────────────────────
const configSchema = z.object({
  format: z.enum(["power", "flex", "stack", "team_plus_player"]),
  picksPerEntry: z.number().int().min(2).max(6),
  numEntries: z.number().int().min(1).max(25),
  varianceProfile: z.enum(["conservative", "balanced", "aggressive", "chaos", "custom"]),
  optimizationObjective: z.enum(["max_ev", "max_profit_prob", "min_drawdown", "balanced_growth", "high_ceiling"]),
  gppMode: z.boolean().optional(),
  maxPerTeam: z.number().int().min(1).max(6).nullable().optional(),
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
  monteCarloIterations: z.number().int().min(1000).max(50000).optional(),
  requiredLineIds: z.array(z.number().int()).optional(),
  biasWeight: z.number().min(0).max(1).optional(),
  gppNarrativeFilters: z.object({
    minGameTotal: z.number().optional(),
    pacePreference: z.enum(["fast", "neutral", "any"]).optional(),
    sharpAlignmentOnly: z.boolean().optional(),
  }).optional(),
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
  payoutMultiplier: number;
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
  // GPP fields
  ceilingRating: number | null;
  ownershipEst: number | null;
  ownershipSource: "real" | "estimated";
  leverageScore: number | null;
  paceTier: string | null;
  sharpSignal: string | null;
  gameTotal: number | null;
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

// payoutFactor scales the entry's payout by the product of any demon (>1) / goblin (<1)
// per-pick multipliers, so the EV reflects PrizePicks' boosted/discounted payouts.
function calcFlexEV(probs: number[], stake: number, payoutFactor = 1): number {
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
    if (mult > 0) ev += stateProb * mult * payoutFactor * stake;
  }
  return ev;
}

// Product of each pick's demon/goblin payout multiplier (standard = 1.0).
function lineupPayoutFactor(picks: ScoredProp[]): number {
  return picks.reduce((acc, p) => acc * (p.payoutMultiplier || 1), 1);
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
  const mult = (POWER_MULT[n] ?? 10) * lineupPayoutFactor(picks);
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
    case "gpp_mode": {
      // GPP: ceiling × (1/ownership) × edge  — rewards high-ceiling low-owned props with edge
      const ceiling = prop.ceilingRating ?? 50;
      const own = Math.max(1, prop.ownershipEst ?? 20);
      // Floor edge at 0.1 intentionally: GPP mode is ceiling-first, not edge-first.
      // Negative-edge props can still offer contrarian leverage value; the floor
      // prevents division-by-near-zero distortion without completely excluding them.
      const safeEdge = Math.max(0.1, edge);
      return (ceiling / own) * safeEdge;
    }
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

function monteCarloPortfolio(lineups: GeneratedLineup[], totalStake: number, iterations = 10000) {
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

    // ── 2b. Bulk query game environment (for GPP game totals) ─────────────
    const gameIds = [...new Set(rows.map(r => r.line.gameId).filter((id): id is number => id !== null))];
    const allGameEnvs = gameIds.length
      ? await db.select().from(gameEnvironmentTable).where(inArray(gameEnvironmentTable.gameId, gameIds))
      : [];
    const gameTotalById = new Map<number, number>();
    for (const ge of allGameEnvs) {
      if (ge.gameId && ge.gameTotal) gameTotalById.set(ge.gameId, parseFloat(ge.gameTotal.toString()));
    }

    // ── 2c. Bulk query team pace ratings (keyed by teamId via teams.abbreviation) ──
    const teamIds = [...new Set(rows.map(r => r.player.teamId).filter((id): id is number => id !== null))];
    const paceByTeamId = new Map<number, "fast" | "normal" | "slow">();
    if (teamIds.length) {
      const allTeams = await db.select({ id: teamsTable.id, abbr: teamsTable.abbreviation, sport: teamsTable.sport })
        .from(teamsTable)
        .where(inArray(teamsTable.id, teamIds));
      const abbrsBySport = new Map<string, { teamId: number; abbr: string }[]>();
      for (const t of allTeams) {
        const key = t.sport;
        if (!abbrsBySport.has(key)) abbrsBySport.set(key, []);
        abbrsBySport.get(key)!.push({ teamId: t.id, abbr: t.abbr });
      }
      const allAbbrs = allTeams.map(t => t.abbr);
      if (allAbbrs.length) {
        // Fetch pace ratings keyed by (teamAbbr, sport) — sport-constrained to avoid cross-sport collisions
        const teamAbbrSportPairs = allTeams.map(t => `${t.abbr}:${t.sport}`);
        const paceRows = await db.select({
          teamAbbr:   teamPaceRatingsTable.teamAbbr,
          sport:      teamPaceRatingsTable.sport,
          season:     teamPaceRatingsTable.season,
          paceRating: teamPaceRatingsTable.paceRating,
        }).from(teamPaceRatingsTable)
          .where(
            and(
              inArray(teamPaceRatingsTable.teamAbbr, allAbbrs),
              inArray(teamPaceRatingsTable.sport, [...new Set(allTeams.map(t => t.sport))]),
            ),
          )
          .orderBy(desc(teamPaceRatingsTable.season));
        // Deduplicate in-memory — keep only the latest season per (abbr, sport) key
        const paceByAbbrSport = new Map<string, number>();
        for (const pr of paceRows) {
          const key = `${pr.teamAbbr}:${pr.sport}`;
          if (!paceByAbbrSport.has(key)) {  // rows ordered DESC by season, so first wins
            paceByAbbrSport.set(key, parseFloat(pr.paceRating.toString()));
          }
        }
        for (const t of allTeams) {
          const rating = paceByAbbrSport.get(`${t.abbr}:${t.sport}`);
          if (rating !== undefined) {
            paceByTeamId.set(t.id, rating > 1.02 ? "fast" : rating < 0.98 ? "slow" : "normal");
          }
        }
      }
    }

    // ── 2d. Bulk query latest sharp signals (for GPP sharp filter) ────────
    const allSharpEvents = ppLineIds.length
      ? await db.select()
          .from(lineMoveEventsTable)
          .where(and(inArray(lineMoveEventsTable.ppLineId, ppLineIds), isNotNull(lineMoveEventsTable.sharpSignal)))
          .orderBy(desc(lineMoveEventsTable.capturedAt))
      : [];
    const latestSharpByLine = new Map<number, { signal: string; moveDirection: string | null }>();
    for (const ev of allSharpEvents) {
      if (ev.ppLineId && !latestSharpByLine.has(ev.ppLineId) && ev.sharpSignal) {
        latestSharpByLine.set(ev.ppLineId, { signal: ev.sharpSignal, moveDirection: ev.moveDirection ?? null });
      }
    }

    // ── 2e. Bulk query today's crowd ownership snapshots ─────────────────
    // Real crowd ownership data takes precedence over tier-based estimates when
    // available.  We look at today's slate date only so stale data from prior
    // slates never bleeds in.  Falls back gracefully to the tier-based estimate
    // when no real data exists.
    const todayStr = new Date().toISOString().slice(0, 10);
    const playerIds = [...new Set(rows.map(r => r.player.id))];
    const crowdOwnershipRows = playerIds.length
      ? await db
          .select({
            playerId:     crowdOwnershipTable.playerId,
            statType:     crowdOwnershipTable.statType,
            ownershipPct: crowdOwnershipTable.ownershipPct,
            source:       crowdOwnershipTable.source,
            capturedAt:   crowdOwnershipTable.capturedAt,
          })
          .from(crowdOwnershipTable)
          .where(
            and(
              eq(crowdOwnershipTable.slateDate, todayStr),
              inArray(crowdOwnershipTable.playerId, playerIds),
            ),
          )
          .orderBy(desc(crowdOwnershipTable.capturedAt))
      : [];

    // Key: "playerId:statType" → most-recently-captured ownership pct (already ordered DESC)
    const crowdOwnershipByKey = new Map<string, number>();
    for (const co of crowdOwnershipRows) {
      if (co.playerId === null) continue;
      const key = `${co.playerId}:${co.statType}`;
      if (!crowdOwnershipByKey.has(key)) {
        crowdOwnershipByKey.set(key, parseFloat(co.ownershipPct.toString()));
      }
    }
    const hasCrowdData = crowdOwnershipByKey.size > 0;

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
    // P(over) of each player/stat's STANDARD line — anchors the auto payout-multiplier
    // estimate for goblin/demon siblings. The factory loads all active player lines, so
    // the standard sibling is reliably present here.
    const standardPOverByStat: Record<string, number> = {};
    for (const row of rows) {
      if (row.line.lineType !== "standard") continue;
      const m = row.proj?.projectedValue ? parseFloat(row.proj.projectedValue.toString()) : null;
      const s = row.proj?.stdDev ? parseFloat(row.proj.stdDev.toString()) : null;
      if (m === null || s === null) continue;
      const eff = row.line.lineValueOverride != null
        ? parseFloat(row.line.lineValueOverride.toString())
        : parseFloat(row.line.lineValue.toString());
      standardPOverByStat[`${row.line.playerId}:${row.line.statType}`] = pOverLine(m, s, eff) / 100;
    }

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
      // Effective line = manual correction if set, else the synced PP value. All edge /
      // probability math below runs against the corrected line so a Slate Board fix
      // actually reaches the optimizer.
      const ppLine = row.line.lineValueOverride != null
        ? parseFloat(row.line.lineValueOverride.toString())
        : parseFloat(row.line.lineValue.toString());
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
      // Tier-specific: P(over) for THIS line's value, not the single stored pOver
      // (which was computed against one arbitrary tier of this player/stat).
      const pMean = row.proj?.projectedValue ? parseFloat(row.proj.projectedValue.toString()) : null;
      const pStd = row.proj?.stdDev ? parseFloat(row.proj.stdDev.toString()) : null;
      const pOver = (pMean !== null && pStd !== null)
        ? pOverLine(pMean, pStd, ppLine) / 100
        : null;
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

      // Hybrid payout multiplier: manual override wins, else an EV-preserving auto
      // estimate anchored to the standard-line P(over). Standard lines stay at 1.0.
      const payoutMultiplier = effectivePayoutMultiplier(
        row.line.payoutMultiplier != null ? parseFloat(row.line.payoutMultiplier.toString()) : null,
        row.line.lineType,
        pOver,
        standardPOverByStat[`${row.line.playerId}:${row.line.statType}`],
      );

      // EV (single-prop contribution for sorting)
      const stake = cfg.stakePerEntry;
      const expectedValue = cfg.format === "flex"
        ? calcFlexEV([hitProbability], stake, payoutMultiplier)
        : hitProbability * (POWER_MULT[cfg.picksPerEntry] ?? 10) * payoutMultiplier * stake - stake;

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

      // ── GPP enrichment ──────────────────────────────────────────────────
      // Ownership estimate: use real crowd data from today's snapshot when
      // available (keyed by playerId:statType).  Falls back to the tier-based
      // estimate (score tier + pOver adjustment) when no real data exists.
      const actionTag = row.score?.actionTag ?? null;
      const crowdKey = `${row.player.id}:${row.line.statType}`;
      const realOwnership = hasCrowdData ? (crowdOwnershipByKey.get(crowdKey) ?? null) : null;

      let ownershipEst: number;
      let ownershipSource: "real" | "estimated";

      if (realOwnership !== null) {
        ownershipEst = Math.round(Math.max(1, Math.min(99, realOwnership)) * 10) / 10;
        ownershipSource = "real";
      } else {
        const tierBases: Record<string, number> = { PLAY: 35, ACTION: 20, WATCH: 10, PASS: 5, "NO-PLAY": 3 };
        const tierMedianPOver: Record<string, number> = { PLAY: 65, ACTION: 55, WATCH: 50, PASS: 45, "NO-PLAY": 40 };
        const tierBase = actionTag && tierBases[actionTag] ? tierBases[actionTag] : 15;
        const tierMedian = actionTag && tierMedianPOver[actionTag] ? tierMedianPOver[actionTag] : 50;
        const pOverPct = pOver !== null ? pOver * 100 : tierMedian;
        const ownershipAdj = Math.max(-10, Math.min(10, (pOverPct - tierMedian) * 0.3));
        ownershipEst = Math.round(Math.max(1, Math.min(60, tierBase + ownershipAdj)) * 10) / 10;
        ownershipSource = "estimated";
      }

      // Pace tier: from team_pace_ratings (via player teamId → teams.abbreviation → pace table)
      const paceTier = row.player.teamId ? (paceByTeamId.get(row.player.teamId) ?? null) : null;

      // Game total from pre-fetched game environment
      const gameTotal = row.line.gameId ? (gameTotalById.get(row.line.gameId) ?? null) : null;

      // Sharp signal — direction-aware: map (stored signal, moveDirection, pickDirection) → sharp_for/sharp_against/public/neutral
      // Line moves UP = books raised the line = sharp money was betting the OVER (more)
      // Line moves DOWN = books lowered the line = sharp money was betting the UNDER (less)
      const rawSharp = latestSharpByLine.get(row.line.id) ?? null;
      let sharpSignal: string | null = null;
      if (rawSharp) {
        if (rawSharp.signal === "sharp" && rawSharp.moveDirection) {
          const sharpOnOver = rawSharp.moveDirection === "up";  // line moved up → sharp bet over
          const pickIsOver  = direction === "more";
          sharpSignal = sharpOnOver === pickIsOver ? "sharp_for" : "sharp_against";
        } else if (rawSharp.signal === "sharp") {
          sharpSignal = "sharp_for";  // no direction data → assume aligned (conservative)
        } else if (rawSharp.signal === "public") {
          sharpSignal = "public";
        } else {
          sharpSignal = "neutral";
        }
      }

      // Ceiling rating for GPP composite score
      const ceilingRating = row.variance?.ceilingRating ?? null;

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
        payoutMultiplier:  Math.round(payoutMultiplier * 100) / 100,
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
        ceilingRating,
        ownershipEst,
        ownershipSource,
        leverageScore:     null, // set after composite scores pass
        paceTier,
        sharpSignal,
        gameTotal,
      });
    }

    // Assign composite scores and GPP leverage scores
    // gppMode is an overlay: when true, use GPP scoring regardless of the base objective.
    const effectiveObjective = cfg.gppMode ? "gpp_mode" : cfg.optimizationObjective;
    for (const sp of allScoredProps) {
      sp.compositeScore = Math.round(calcCompositeScore(sp, effectiveObjective) * 100) / 100;
      // Leverage = ceiling EV / ownership — how much ceiling-adjusted value per unit of ownership taken on
      // ceiling EV = (ceilingRating / 100) * expectedValue; divide by ownershipEst to get per-ownership value
      const own = Math.max(1, sp.ownershipEst ?? 20);
      const ceil = sp.ceilingRating ?? 50;
      sp.leverageScore = Math.round((ceil / 100) * sp.expectedValue / (own / 100) * 10) / 10;
    }

    // ── Bias adjustment ────────────────────────────────────────────────────
    // When biasWeight > 0, fetch personal hit-rate vs model-pOver delta
    // (same data as /api/dashboard/stat-bias) and add biasWeight × delta to
    // every eligible prop's compositeScore so picks where the user historically
    // outperforms the model rank higher in lineup selection.
    if (cfg.biasWeight && cfg.biasWeight > 0) {
      try {
        const { sql: sqlFn, isNotNull: isNotNullFn } = await import("drizzle-orm");
        const biasRows = await db
          .select({
            sport:    playersTable.sport,
            statType: entryPicksTable.statType,
            tier:     entryPicksTable.lineType,
            gradedCount: sqlFn<number>`count(*) filter (where ${entryPicksTable.result} in ('hit','miss'))`,
            hitCount:    sqlFn<number>`count(*) filter (where ${entryPicksTable.result} = 'hit')`,
            modelOverCount: sqlFn<number>`count(*) filter (where ${entryPicksTable.result} in ('hit','miss') and ${entryPicksTable.projectionGap} is not null and ${entryPicksTable.projectionGap}::float > 0)`,
            modelNonNullCount: sqlFn<number>`count(*) filter (where ${entryPicksTable.result} in ('hit','miss') and ${entryPicksTable.projectionGap} is not null)`,
          })
          .from(entryPicksTable)
          .innerJoin(entriesTable, eq(entryPicksTable.entryId, entriesTable.id))
          .leftJoin(playersTable, eq(entryPicksTable.playerId, playersTable.id))
          .where(isNotNullFn(entryPicksTable.playerId))
          .groupBy(playersTable.sport, entryPicksTable.statType, entryPicksTable.lineType);

        const biasMap = new Map<string, number>();
        for (const r of biasRows) {
          const graded = Number(r.gradedCount);
          if (graded < 10) continue;
          const hitRate = Number(r.hitCount) / graded;
          const nonNull = Number(r.modelNonNullCount);
          if (nonNull === 0) continue;
          const avgModelPOver = (Number(r.modelOverCount) / nonNull) * 100;
          const delta = hitRate * 100 - avgModelPOver;
          biasMap.set(`${r.sport ?? ""}|${r.statType}|${r.tier}`, delta);
        }

        const bw = cfg.biasWeight;
        for (const sp of allScoredProps) {
          const delta =
            biasMap.get(`${sp.sport}|${sp.statType}|${sp.lineType}`) ??
            biasMap.get(`${sp.sport}|${sp.statType}|standard`) ??
            biasMap.get(`|${sp.statType}|${sp.lineType}`) ??
            biasMap.get(`|${sp.statType}|standard`) ??
            null;
          if (delta != null) {
            sp.compositeScore = Math.round((sp.compositeScore + bw * delta) * 100) / 100;
          }
        }
      } catch (err) {
        logger.warn({ err }, "bias adjustment failed — proceeding without bias");
      }
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

      // ── GPP narrative filters (only applied when gppMode toggle is on) ──
      if (cfg.gppMode && cfg.gppNarrativeFilters) {
        const { minGameTotal, pacePreference, sharpAlignmentOnly } = cfg.gppNarrativeFilters;
        // Game total threshold — exclude props from games below threshold OR with unknown total
        if (minGameTotal !== undefined && (p.gameTotal === null || p.gameTotal < minGameTotal)) return false;
        // Pace preference — use paceTier from projection paceFactor
        if (pacePreference === "fast" && p.paceTier !== "fast") return false;
        if (pacePreference === "neutral" && p.paceTier === "slow") return false;
        // Sharp alignment — exclude props where sharp money opposes the pick direction
        if (sharpAlignmentOnly && p.sharpSignal === "sharp_against") return false;
      }

      return true;
    });

    eligible.sort((a, b) => b.compositeScore - a.compositeScore);
    const filteredPropCount = eligible.length;

    // ── 6. Generate lineups ────────────────────────────────────────────────

    // Resolve required picks — sourced from allScoredProps so they bypass
    // eligibility filters (player_out is still excluded as unplayable).
    const requiredIds = new Set(cfg.requiredLineIds ?? []);
    const requiredProps: ScoredProp[] = [];
    if (requiredIds.size > 0) {
      for (const sp of allScoredProps) {
        if (requiredIds.has(sp.ppLineId) && sp.noPlayReason !== "player_out") {
          requiredProps.push(sp);
        }
      }
    }

    // Build warning message for the caller
    const warningParts: string[] = [];

    // 1. Picks not found in the active pool (e.g. delisted, or player_out)
    const missingRequired = [...requiredIds].filter(id => !requiredProps.some(p => p.ppLineId === id));
    if (missingRequired.length > 0) {
      warningParts.push(`${missingRequired.length} required pick(s) could not be found in the active prop pool and were skipped.`);
    }

    // 2. More required picks than the lineup pick limit
    if (requiredProps.length > cfg.picksPerEntry) {
      warningParts.push(`${requiredProps.length} required picks exceed the ${cfg.picksPerEntry}-pick limit — only the top ${cfg.picksPerEntry} (by composite score) will be used.`);
      requiredProps.sort((a, b) => b.compositeScore - a.compositeScore);
      requiredProps.splice(cfg.picksPerEntry);
    }

    // 3. Cross-sport conflicts — PrizePicks entries are single-sport, so the first
    //    required pick's sport wins and any required picks with a different sport would
    //    be silently skipped in every lineup. Detect this statically and warn up-front.
    if (requiredProps.length > 1) {
      const winningSport = requiredProps[0].sport;
      const crossSportConflicts = requiredProps.filter(p => p.sport !== winningSport);
      if (crossSportConflicts.length > 0) {
        const conflictNames = crossSportConflicts.map(p => `${p.playerName} (${p.sport})`).join(", ");
        warningParts.push(
          `${crossSportConflicts.length} required pick(s) conflict with the lineup sport (${winningSport}) set by the first locked pick and will be excluded from every lineup: ${conflictNames}.`,
        );
        // Remove cross-sport conflicts from required list so the loop is consistent
        // with the warning and users don't get unexplained missing picks.
        crossSportConflicts.forEach(c => {
          const idx = requiredProps.findIndex(p => p.ppLineId === c.ppLineId);
          if (idx !== -1) requiredProps.splice(idx, 1);
        });
      }
    }

    const requiredLinesWarning = warningParts.length > 0 ? warningParts.join(" ") : undefined;

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

      // Pool selection with profile-based randomization.
      // Required picks are excluded from the pool — they are pre-seeded below.
      const requiredPickIds = new Set(requiredProps.map(p => p.ppLineId));
      const eligiblePool = eligible.filter(p => !requiredPickIds.has(p.ppLineId));

      let pool: ScoredProp[];
      const seed = luIdx * 7919 + 31337;
      if (cfg.varianceProfile === "chaos") {
        pool = seededShuffle(eligiblePool, seed);
      } else if (cfg.varianceProfile === "aggressive") {
        const top = Math.max(n, Math.ceil(eligiblePool.length * 0.70));
        pool = seededShuffle(eligiblePool.slice(0, top), seed);
      } else if (cfg.varianceProfile === "balanced") {
        const top = Math.max(n, Math.ceil(eligiblePool.length * 0.60));
        pool = seededShuffle(eligiblePool.slice(0, top), seed);
      } else {
        const top = Math.max(n, Math.ceil(eligiblePool.length * 0.50));
        pool = seededShuffle(eligiblePool.slice(0, top), seed + luIdx);
      }

      // Pre-seed picks with required props. The first required pick fixes the
      // lineup sport; subsequent required picks of a different sport are skipped.
      const picks: ScoredProp[] = [];
      let lineupSport: string | null = null;
      for (const req of requiredProps) {
        if (picks.length >= n) break;
        if (lineupSport && req.sport !== lineupSport) continue;
        picks.push(req);
        if (!lineupSport) lineupSport = req.sport;
      }

      const totalFuture = cfg.numEntries;

      for (const candidate of pool) {
        if (picks.length >= n) break;
        if (picks.some(p => p.ppLineId === candidate.ppLineId)) continue;
        if (lineupSport && candidate.sport !== lineupSport) continue;

        const afterPlayer = (playerCounts[candidate.playerId] ?? 0) + 1;
        if (afterPlayer / totalFuture > cfg.maxPlayerExposure + 0.001) continue;

        const afterPick = (pickCounts[candidate.ppLineId] ?? 0) + 1;
        if (afterPick / totalFuture > cfg.maxPickExposure + 0.001) continue;

        if (candidate.teamId) {
          const afterTeam = (teamCounts[candidate.teamId] ?? 0) + 1;
          if (afterTeam / totalFuture > cfg.maxTeamExposure + 0.001) continue;
          // Per-lineup team cap: count how many picks in THIS lineup are from the same team
          if (cfg.maxPerTeam != null) {
            const inLineupFromTeam = picks.filter(p => p.teamId === candidate.teamId).length;
            if (inLineupFromTeam >= cfg.maxPerTeam) continue;
          }
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
        if (!lineupSport) lineupSport = candidate.sport;
      }

      // Relaxed fallback: drop overlap constraint to fill lineup (same sport only)
      if (picks.length < n) {
        for (const candidate of pool) {
          if (picks.length >= n) break;
          if (picks.some(p => p.ppLineId === candidate.ppLineId)) continue;
          if (picks.some(p => p.playerId === candidate.playerId && p.statType === candidate.statType)) continue;
          if (lineupSport && candidate.sport !== lineupSport) continue;
          // Still honour per-lineup team cap even in the relaxed fallback
          if (cfg.maxPerTeam != null && candidate.teamId) {
            const inLineupFromTeam = picks.filter(p => p.teamId === candidate.teamId).length;
            if (inLineupFromTeam >= cfg.maxPerTeam) continue;
          }
          picks.push(candidate);
          if (!lineupSport) lineupSport = candidate.sport;
        }
      }

      if (picks.length < 2) continue;

      const stake = cfg.stakePerEntry;
      // Product of demon/goblin payout boosts/discounts across the lineup's picks.
      const payoutFactor = lineupPayoutFactor(picks);
      let ev: number, pHit: number, grossPayout: number;
      let correlationAdjusted = false;
      let correlationNote: string | null = null;

      if (cfg.format === "flex") {
        ev = calcFlexEV(picks.map(p => p.hitProbability), stake, payoutFactor);
        pHit = picks.reduce((acc, p) => acc * p.hitProbability, 1);
        grossPayout = (getFlexMultiplier(picks.length, picks.length) || 1) * payoutFactor * stake;
        correlationAdjusted = picks.some((p, i) => picks.slice(i + 1).some(q => q.playerId === p.playerId));
      } else {
        const result = calcPowerEV(picks, stake, picks.length);
        ev = result.ev;
        pHit = result.pHit;
        grossPayout = (POWER_MULT[picks.length] ?? 10) * payoutFactor * stake;
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
    const { probBreakEven, probProfitable } = monteCarloPortfolio(lineups, totalStake, cfg.monteCarloIterations ?? 10000);

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
      scoredProps:          allScoredProps.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 200),
      eligiblePropCount,
      filteredPropCount,
      generationConfig:     cfg,
      ...(requiredLinesWarning ? { requiredLinesWarning } : {}),
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
