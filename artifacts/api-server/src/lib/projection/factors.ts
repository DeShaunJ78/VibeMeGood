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
    genericHome: 0.01,
    genericAway: -0.01,
    splitWeight: 0.4, // weight on historical home/away split when available
    clamp: { min: 0.97, max: 1.03 },
  },
  nflAdvanced: {
    targetShareWeight: 0.6, // (targetShare - posBaseline) * weight
    woprWeight: 0.25,
    clamp: { min: 0.94, max: 1.08 },
  },
  snap: {
    clamp: { min: 0.9, max: 1.0 },
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

/** NFL advanced usage (target share / WOPR) for receiving props. */
export function nflAdvancedFactor(input: {
  targetShare?: number | null; // 0..1
  wopr?: number | null;
  posBaselineTargetShare?: number | null; // 0..1
  statType: string;
}): FactorResult | null {
  if (!isReceivingStat(input.statType)) return null;
  const c = FACTOR_CONFIG.nflAdvanced;
  let adj = 0;
  const notes: string[] = [];
  const baseline = input.posBaselineTargetShare ?? 0.18;
  if (input.targetShare != null) {
    adj += (input.targetShare - baseline) * c.targetShareWeight;
    notes.push(`${Math.round(input.targetShare * 100)}% target share`);
  }
  if (input.wopr != null) {
    // WOPR ~0.6 is a high-end every-down receiver; center around 0.45.
    adj += (input.wopr - 0.45) * c.woprWeight;
    notes.push(`WOPR ${input.wopr.toFixed(2)}`);
  }
  if (adj === 0 || notes.length === 0) return null;
  const factor = clamp(1 + adj, c.clamp.min, c.clamp.max);
  if (Math.abs(factor - 1) < 0.002) return null;
  return {
    key: "nflAdvanced",
    label: "NFL usage (target share / WOPR)",
    factor: round3(factor),
    explain: `${notes.join(", ")} → ×${factor.toFixed(3)}`,
  };
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
