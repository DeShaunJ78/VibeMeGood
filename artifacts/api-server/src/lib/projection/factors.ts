/**
 * Projection factor engine.
 *
 * Every new edge signal is expressed here as a BOUNDED, CONSERVATIVE, TRANSPARENT,
 * TUNABLE multiplier applied to a player's projected mean.
 *
 *  - Bounded   : each factor is clamped to its own cap, and the combined product is
 *                clamped to COMBINED so no stack of signals can run away.
 *  - Conservative: coefficients are deliberately small.
 *  - Transparent : every applied factor returns {key,label,factor,explain} that is
 *                  stored on our_projections.adjustments and surfaced in the UI.
 *  - Tunable   : all coefficients live in FACTOR_CONFIG below — one place to dial.
 *  - No silent no-ops: when a factor has no data it returns null (not a fake 1.0 that
 *                  pretends to be a signal). Only applied factors are recorded.
 */

export interface FactorResult {
  key: string;
  label: string;
  factor: number; // multiplier on the projected mean
  explain: string;
  /** Optional stdDev multiplier (e.g. aDOT variance widening/narrowing). */
  stdMultiplier?: number;
}

/** All tunable coefficients and caps. Edit here to retune the model. */
export const FACTOR_CONFIG = {
  /** Global clamp on the PRODUCT of all factors. */
  combined: { min: 0.85, max: 1.15 },

  rest: {
    backToBack: -0.03,
    threeInFour: -0.02,
    wellRested: 0.015, // daysRest >= 4 (or negative fatigue score)
    clamp: { min: 0.95, max: 1.02 },
  },
  pace: {
    // pace.getPaceAdjustment() returns roughly ±0.06; we damp it.
    weight: 0.5,
    clamp: { min: 0.97, max: 1.03 },
  },
  dvp: {
    // teamAllowed/leagueAvg deviation blended at this weight.
    weight: 0.4,
    clamp: { min: 0.94, max: 1.06 },
    minGames: 5, // require this many opponent-vs-position games
  },
  impliedTotal: {
    weight: 0.35,
    clamp: { min: 0.96, max: 1.04 },
  },
  weather: {
    // Weather only hurts (cap max at 1.0).
    windBreakpoint: 12, // mph below which no penalty
    windPerMph: 0.006, // penalty per mph over breakpoint (passing/receiving/kicking)
    coldBreakpoint: 32, // °F below which a small passing penalty applies
    coldPenalty: 0.02,
    clamp: { min: 0.9, max: 1.0 },
  },
  homeAway: {
    genericHome: 0.0,   // zeroed: assumption-based nudge was empirically net-negative
    genericAway: 0.0,   // factor now fires ONLY when actual home/away split data exists
    splitWeight: 0.4,   // weight on historical home/away split when available
    clamp: { min: 0.97, max: 1.03 },
  },
  nflAdvanced: {
    airYardsShareWeight: 0.4,  // (airYardsShare - 0.20) * weight
    targetShareWeight:   0.35, // (targetShare - posBaseline) * weight
    woprWeight:          0.25, // (wopr - 0.45) * weight
    clamp: { min: 0.94, max: 1.08 },
  },
  redZone: {
    weight: 0.5,
    clamp: { min: 0.94, max: 1.08 },
    rbRzCarryBaseline:   0.22, // RB red zone carry share league average
    wrTeRzTargetBaseline: 0.12, // WR/TE red zone target share league average
  },
  snap: {
    clamp: { min: 0.9, max: 1.0 },
  },
  minutes: {
    clamp: { min: 0.70, max: 1.40 },
  },
  usageRate: {
    weight: 0.7,
    clamp: { min: 0.80, max: 1.30 },
  },
  threePointDefense: {
    weight: 0.35,
    clamp: { min: 0.80, max: 1.20 },
    minGames: 20,
  },
} as const;

/** Baseline team total (points/runs/goals) per sport, used to scale implied-total. */
export const SPORT_IMPLIED_BASELINE: Record<string, number> = {
  NBA: 114,
  WNBA: 84,
  NFL: 22.5,
  MLB: 4.5,
  NHL: 3.0,
};

/**
 * Implied team total from a HOME point spread + game total.
 *   home total = total/2 − spread/2 ;  away total = total/2 + spread/2
 * (games.spread is stored as the HOME spread: negative = home favored.)
 */
export function impliedTeamTotal(
  total: number | null,
  homeSpread: number | null,
  isHome: boolean,
): number | null {
  if (total == null || homeSpread == null) return null;
  return isHome ? total / 2 - homeSpread / 2 : total / 2 + homeSpread / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ── stat-type classification helpers (case-insensitive keyword match) ─────────
const VOLUME_KEYWORDS = [
  "point", "pts", "rebound", "reb", "assist", "ast", "three", "3-pt", "3 pt",
  "shot", "goal", "save", "passing yard", "rushing yard", "receiving yard",
  "reception", "total base", "hit", "strikeout",
];

export function isVolumeStat(statType: string): boolean {
  const s = statType.toLowerCase();
  return VOLUME_KEYWORDS.some((k) => s.includes(k));
}

const PASSING_RECEIVING_KEYWORDS = [
  "passing", "receiving", "reception", "pass yard", "rec yard", "field goal", "kicking",
];

export function isWeatherSensitive(statType: string): boolean {
  const s = statType.toLowerCase();
  return PASSING_RECEIVING_KEYWORDS.some((k) => s.includes(k));
}

const RECEIVING_KEYWORDS = ["receiving", "reception", "rec yard"];
export function isReceivingStat(statType: string): boolean {
  const s = statType.toLowerCase();
  return RECEIVING_KEYWORDS.some((k) => s.includes(k));
}

const NFL_TD_KEYWORDS = ["td scored", "tds scored", "rush td", "rec td"];
/** Matches NFL touchdown props (TDs Scored, Rush TDs, Rec TDs). */
export function isNFLTDStat(statType: string): boolean {
  const s = statType.toLowerCase();
  return NFL_TD_KEYWORDS.some((k) => s.includes(k));
}

const NBA_COUNTING_KEYWORDS = ["point", "pts", "rebound", "reb", "assist", "ast", "3-pt", "three", "block", "steal"];
/** NBA/WNBA single-stat counting props eligible for minutes/usage adjustment. Excludes combos. */
export function isNBACountingStat(statType: string): boolean {
  const s = statType.toLowerCase();
  if (s.includes("+")) return false; // exclude combo stats
  return NBA_COUNTING_KEYWORDS.some((k) => s.includes(k));
}

/** Matches 3-point made/attempted stat types. */
export function is3PTStat(statType: string): boolean {
  const s = statType.toLowerCase();
  return s.includes("3-pt") || s.includes("3pt") || s.includes("3pm") || s.includes("three");
}

// ── individual factor builders ───────────────────────────────────────────────

export function restFactor(input: {
  isBackToBack?: boolean | null;
  isThreeInFour?: boolean | null;
  daysRest?: number | null;
  fatigueScore?: number | null;
}): FactorResult | null {
  const c = FACTOR_CONFIG.rest;
  let adj = 0;
  const notes: string[] = [];

  if (input.isBackToBack) {
    adj += c.backToBack;
    notes.push("back-to-back");
  }
  if (input.isThreeInFour) {
    adj += c.threeInFour;
    notes.push("3-in-4 games");
  }
  const rested =
    (input.daysRest != null && input.daysRest >= 4) ||
    (input.fatigueScore != null && input.fatigueScore <= -5);
  if (rested && !input.isBackToBack) {
    adj += c.wellRested;
    notes.push("well rested");
  }

  if (adj === 0) return null;
  const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
  return {
    key: "rest",
    label: "Rest / fatigue",
    factor: round3(factor),
    explain: `${notes.join(", ")} → ×${factor.toFixed(3)}`,
  };
}

/** @param paceAdjustment value from analytics/pace.getPaceAdjustment (≈ ±0.06). */
export function paceFactor(
  paceAdjustment: number | null,
  estimatedGamePace: number | null,
  statType: string,
): FactorResult | null {
  if (paceAdjustment == null || paceAdjustment === 0) return null;
  if (!isVolumeStat(statType)) return null;
  const c = FACTOR_CONFIG.pace;
  const factor = clamp(1 + paceAdjustment * c.weight, c.clamp.min, c.clamp.max);
  const paceTxt = estimatedGamePace != null ? `${estimatedGamePace.toFixed(1)} poss/48` : "game pace";
  return {
    key: "pace",
    label: "Game pace",
    factor: round3(factor),
    explain: `${paceTxt} → ×${factor.toFixed(3)}`,
  };
}

/** Defense vs position. @param teamAllowed avg the opponent allows to this position+stat;
 *  @param leagueAvg league baseline for the same position+stat. */
export function dvpFactor(input: {
  teamAllowed: number | null;
  leagueAvg: number | null;
  games: number | null;
}): FactorResult | null {
  const c = FACTOR_CONFIG.dvp;
  if (
    input.teamAllowed == null ||
    input.leagueAvg == null ||
    input.leagueAvg <= 0 ||
    (input.games ?? 0) < c.minGames
  ) {
    return null;
  }
  const ratio = input.teamAllowed / input.leagueAvg;
  const factor = clamp(1 + (ratio - 1) * c.weight, c.clamp.min, c.clamp.max);
  if (Math.abs(factor - 1) < 0.002) return null;
  const dir = ratio > 1 ? "soft" : "tough";
  return {
    key: "dvp",
    label: "Defense vs position",
    factor: round3(factor),
    explain: `Opp allows ${input.teamAllowed.toFixed(1)} vs league ${input.leagueAvg.toFixed(1)} (${dir}) → ×${factor.toFixed(3)}`,
  };
}

/** Implied team total vs a sport baseline (more team scoring → more volume). */
export function impliedTotalFactor(
  impliedTeamTotal: number | null,
  baseline: number | null,
  statType: string,
): FactorResult | null {
  if (impliedTeamTotal == null || baseline == null || baseline <= 0) return null;
  if (!isVolumeStat(statType)) return null;
  const c = FACTOR_CONFIG.impliedTotal;
  const ratio = impliedTeamTotal / baseline;
  const factor = clamp(1 + (ratio - 1) * c.weight, c.clamp.min, c.clamp.max);
  if (Math.abs(factor - 1) < 0.002) return null;
  return {
    key: "impliedTotal",
    label: "Implied team total",
    factor: round3(factor),
    explain: `Implied ${impliedTeamTotal.toFixed(1)} vs avg ${baseline.toFixed(1)} → ×${factor.toFixed(3)}`,
  };
}

/** Weather penalty for outdoor games (NFL). Only hurts. */
export function weatherFactor(input: {
  isOutdoor?: boolean | null;
  windSpeed?: number | null;
  temp?: number | null;
  statType: string;
}): FactorResult | null {
  if (!input.isOutdoor) return null;
  if (!isWeatherSensitive(input.statType)) return null;
  const c = FACTOR_CONFIG.weather;
  let adj = 0;
  const notes: string[] = [];
  if (input.windSpeed != null && input.windSpeed > c.windBreakpoint) {
    adj -= (input.windSpeed - c.windBreakpoint) * c.windPerMph;
    notes.push(`${Math.round(input.windSpeed)}mph wind`);
  }
  if (input.temp != null && input.temp < c.coldBreakpoint) {
    adj -= c.coldPenalty;
    notes.push(`${Math.round(input.temp)}°F`);
  }
  if (adj === 0) return null;
  const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
  return {
    key: "weather",
    label: "Weather",
    factor: round3(factor),
    explain: `${notes.join(", ")} → ×${factor.toFixed(3)}`,
  };
}

/** Home/away. Uses historical split when available, else a small generic edge. */
export function homeAwayFactor(input: {
  isHome: boolean | null;
  homeAvg?: number | null;
  awayAvg?: number | null;
}): FactorResult | null {
  if (input.isHome == null) return null;
  const c = FACTOR_CONFIG.homeAway;

  // Blend generic edge with historical split if both splits are present.
  let adj = input.isHome ? c.genericHome : c.genericAway;
  let basis = "home-court edge";
  if (
    input.homeAvg != null &&
    input.awayAvg != null &&
    input.homeAvg > 0 &&
    input.awayAvg > 0
  ) {
    const overall = (input.homeAvg + input.awayAvg) / 2;
    const sideAvg = input.isHome ? input.homeAvg : input.awayAvg;
    const splitAdj = (sideAvg / overall - 1) * c.splitWeight;
    adj = adj * (1 - c.splitWeight) + splitAdj;
    basis = "home/away split";
  }
  const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
  if (Math.abs(factor - 1) < 0.002) return null;
  return {
    key: "homeAway",
    label: input.isHome ? "Home game" : "Away game",
    factor: round3(factor),
    explain: `${basis} → ×${factor.toFixed(3)}`,
  };
}

/**
 * NFL advanced usage factor for receiving props.
 * Blends air yards share (0.4), target share (0.35), and WOPR (0.25).
 * Also computes an aDOT stdDev multiplier — deep routes widen variance,
 * short routes narrow it — stored on stdMultiplier for compute.ts.
 */
export function nflAdvancedFactor(input: {
  targetShare?: number | null;     // 0..1
  airYardsShare?: number | null;   // 0..1
  wopr?: number | null;
  aDot?: number | null;            // average depth of target (yards)
  posBaselineTargetShare?: number | null; // 0..1
  statType: string;
}): FactorResult | null {
  if (!isReceivingStat(input.statType)) return null;
  const c = FACTOR_CONFIG.nflAdvanced;
  let adj = 0;
  const notes: string[] = [];
  const baseline = input.posBaselineTargetShare ?? 0.18;

  if (input.airYardsShare != null) {
    adj += (input.airYardsShare - 0.20) * c.airYardsShareWeight;
    notes.push(`${Math.round(input.airYardsShare * 100)}% AY-share`);
  }
  if (input.targetShare != null) {
    adj += (input.targetShare - baseline) * c.targetShareWeight;
    notes.push(`${Math.round(input.targetShare * 100)}% tgt-share`);
  }
  if (input.wopr != null) {
    // WOPR ~0.6 is a high-end every-down receiver; center around 0.45.
    adj += (input.wopr - 0.45) * c.woprWeight;
    notes.push(`WOPR ${input.wopr.toFixed(2)}`);
  }
  if (adj === 0 || notes.length === 0) return null;
  const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
  if (Math.abs(factor - 1) < 0.002) return null;

  // aDOT variance modifier: deep routes widen variance; short routes narrow it.
  let stdMultiplier: number | undefined;
  if (input.aDot != null) {
    if (input.aDot > 10) {
      stdMultiplier = round3(Math.min(1.20, 1 + (input.aDot - 10) * 0.025));
    } else if (input.aDot < 5) {
      stdMultiplier = round3(Math.max(0.85, 1 - (5 - input.aDot) * 0.03));
    }
  }

  const explain = `${notes.join(", ")} → ×${factor.toFixed(3)}`
    + (stdMultiplier != null ? ` (σ×${stdMultiplier.toFixed(2)})` : "");

  return {
    key: "nflAdvanced",
    label: "NFL usage (AY-share / tgt-share / WOPR)",
    factor: round3(factor),
    explain,
    ...(stdMultiplier != null ? { stdMultiplier } : {}),
  };
}

/**
 * NFL red zone factor for TD props ("TDs Scored", "Rush TDs", "Rec TDs").
 * RBs use red zone carry share; WR/TE use red zone target share.
 * Returns null when the stat type is not a TD prop or data is unavailable.
 */
export function redZoneFactor(input: {
  redZoneTargetShare?: number | null; // 0..1
  redZoneCarryShare?: number | null;  // 0..1
  position?: string | null;
  statType: string;
}): FactorResult | null {
  if (!isNFLTDStat(input.statType)) return null;
  const c = FACTOR_CONFIG.redZone;
  const pos = (input.position ?? "").toUpperCase();
  const isRB = pos === "RB" || pos === "FB";

  if (isRB && input.redZoneCarryShare != null) {
    const adj = (input.redZoneCarryShare - c.rbRzCarryBaseline) * c.weight;
    if (Math.abs(adj) < 0.01) return null;
    const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
    return {
      key: "redZone",
      label: "Red zone carry share",
      factor: round3(factor),
      explain: `${Math.round(input.redZoneCarryShare * 100)}% RZ carries vs ${Math.round(c.rbRzCarryBaseline * 100)}% baseline → ×${factor.toFixed(3)}`,
    };
  }

  if (!isRB && input.redZoneTargetShare != null) {
    const adj = (input.redZoneTargetShare - c.wrTeRzTargetBaseline) * c.weight;
    if (Math.abs(adj) < 0.01) return null;
    const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
    return {
      key: "redZone",
      label: "Red zone target share",
      factor: round3(factor),
      explain: `${Math.round(input.redZoneTargetShare * 100)}% RZ targets vs ${Math.round(c.wrTeRzTargetBaseline * 100)}% baseline → ×${factor.toFixed(3)}`,
    };
  }

  return null;
}

/** NFL snap-rate factor. @param snapPct 0..1. */
export function snapFactor(snapPct: number | null): FactorResult | null {
  if (snapPct == null) return null;
  const c = FACTOR_CONFIG.snap;
  let factor: number;
  if (snapPct >= 0.8) return null; // full participation — no adjustment to record
  else if (snapPct >= 0.6) factor = 0.97;
  else factor = 0.92;
  factor = clamp(factor, c.clamp.min, c.clamp.max);
  return {
    key: "snap",
    label: "Snap rate",
    factor: round3(factor),
    explain: `${Math.round(snapPct * 100)}% snaps → ×${factor.toFixed(3)}`,
  };
}

/** MLB park factor. @param parkFactor e.g. 1.18 hitter-friendly. */
export function parkFactor(park: number | null, abbr: string | null): FactorResult | null {
  if (park == null || park === 1.0) return null;
  return {
    key: "park",
    label: "Ballpark",
    factor: round3(park),
    explain: `${abbr ?? "park"} factor ×${park.toFixed(2)}`,
  };
}

/**
 * NBA/WNBA minutes projection factor.
 * Scales counting stats proportionally to projected vs. season-average minutes.
 * Only fires when a lineup confirmation provides expectedMinutes.
 */
export function minutesFactor(
  expectedMinutes: number | null,
  seasonAvgMinutes: number | null,
  statType: string,
): FactorResult | null {
  if (expectedMinutes == null || seasonAvgMinutes == null || seasonAvgMinutes <= 0) return null;
  if (!isNBACountingStat(statType)) return null;
  const c = FACTOR_CONFIG.minutes;
  const ratio = expectedMinutes / seasonAvgMinutes;
  if (Math.abs(ratio - 1) < 0.04) return null; // skip trivial adjustments
  const factor = clamp(ratio, c.clamp.min, c.clamp.max);
  const dir = ratio > 1 ? "↑" : "↓";
  return {
    key: "minutes",
    label: "Projected minutes",
    factor: round3(factor),
    explain: `${dir}${expectedMinutes.toFixed(1)} min projected vs ${seasonAvgMinutes.toFixed(1)} avg → ×${factor.toFixed(3)}`,
  };
}

/**
 * NBA/WNBA usage rate factor.
 * Computes a USG%-proxy signal: (player's avg val/game) / (position avg val/game)
 * normalized to the position's USG% baseline (PG≈28%, SG≈25%, SF≈22%, PF≈20%, C≈18%).
 * Both inputs should be in the same 0-100 percentage scale.
 *
 * True USG% (FGA + 0.44·FTA + TOV) is not computable from PrizePicks stat rows
 * alone (FGA/FTA aren't tracked as separate props), so per-game output normalized
 * by position is the highest-fidelity proxy available from local game-log data.
 */
export function usageRateFactor(
  usagePct: number | null,            // player's estimated USG% proxy (0-100)
  positionBaselinePct: number | null, // position avg USG% (0-100); e.g. PG=28, C=18
  statType: string,
): FactorResult | null {
  if (usagePct == null || positionBaselinePct == null || positionBaselinePct <= 0) return null;
  if (!isNBACountingStat(statType)) return null;
  const c = FACTOR_CONFIG.usageRate;
  const ratio = usagePct / positionBaselinePct;
  const adj = (ratio - 1) * c.weight;
  if (Math.abs(adj) < 0.03) return null;
  const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
  const dir = ratio > 1 ? "high" : "low";
  return {
    key: "usageRate",
    label: "Usage rate",
    factor: round3(factor),
    explain: `${dir}-usage: USG% proxy ${usagePct.toFixed(1)}% vs position avg ${positionBaselinePct.toFixed(1)}% → ×${factor.toFixed(3)}`,
  };
}

/**
 * NBA/WNBA 3-point defense factor.
 * Uses team-wide (all-position) 3PM allowed per game vs. league average.
 * Provides a dedicated signal for 3PM/3PA props separate from generic DvP.
 */
export function threePointDefenseFactor(input: {
  allowed3PM: number | null;
  league3PM: number | null;
  games: number | null;
}): FactorResult | null {
  const c = FACTOR_CONFIG.threePointDefense;
  if (
    input.allowed3PM == null ||
    input.league3PM == null ||
    input.league3PM <= 0 ||
    (input.games ?? 0) < c.minGames
  ) {
    return null;
  }
  const ratio = input.allowed3PM / input.league3PM;
  const factor = clamp(1 + (ratio - 1) * c.weight, c.clamp.min, c.clamp.max);
  if (Math.abs(factor - 1) < 0.003) return null;
  const dir = ratio > 1 ? "soft 3P-D" : "tough 3P-D";
  return {
    key: "3pDefense",
    label: "3P defense",
    factor: round3(factor),
    explain: `Opp allows ${input.allowed3PM.toFixed(1)} 3PM/game vs league ${input.league3PM.toFixed(1)} (${dir}) → ×${factor.toFixed(3)}`,
  };
}

// ── combine ──────────────────────────────────────────────────────────────────

export interface CombineResult {
  combinedFactor: number;
  applied: FactorResult[];
  clamped: boolean;
}

/** Multiply all applied factors, clamp the product, return the breakdown. */
export function combineFactors(factors: (FactorResult | null)[]): CombineResult {
  const applied = factors.filter((f): f is FactorResult => f != null);
  const product = applied.reduce((acc, f) => acc * f.factor, 1);
  const c = FACTOR_CONFIG.combined;
  const clampedFactor = clamp(product, c.min, c.max);
  return {
    combinedFactor: round3(clampedFactor),
    applied,
    clamped: Math.abs(clampedFactor - product) > 1e-9,
  };
}
