/**
 * Statistical distribution routing for PrizePicks prop modeling.
 *
 * Stage 1 — Poisson: clean sparse counting stats where variance ≈ mean.
 *   Home Runs, Goals, TDs, 3-PT Made.
 *
 * Stage 2 — Negative Binomial: overdispersed counting stats where variance > mean.
 *   RBIs, Hits, Walks, NHL Assists, Doubles, Runs, Singles.
 *   Dispersion r derived dynamically: r = mean²/(sigma²−mean).
 *   Falls back to Poisson when underdispersed.
 *
 * Stage 3 — Zero-Inflated Poisson: structurally zero-inflated stats.
 *   Stolen Bases, Power Play Points, Blocked Shots.
 *   π per stat is the structural-zero rate; λ_eff = mean/(1−π) preserves E[X].
 *
 * Stage 4 — Log-normal: right-skewed continuous yardage stats.
 *   Pass Yards, Rush Yards, Receiving Yards.
 *   Log-normal parameters derived from (mean, sigma) via moment-matching.
 *   GUARDED by STAGE4_LOGNORMAL_ENABLED — set false to revert to Normal.
 *   Do not make permanent until Brier+ECE beat Stage 3 after recalibration.
 *
 * Single swap point for all consumers:
 *   pOverLineDist(mean, sigma, line, statType)        — returns 0–100
 *   percentileAtLineDist(mean, sigma, line, statType)  — returns 0–100
 */

import { pOverLine, percentileAtLine, normalCDF } from "./normal-dist";

// ---------------------------------------------------------------------------
// Stage 4 feature flag
// ---------------------------------------------------------------------------

/**
 * Set true to enable log-normal routing for yardage stats (Stage 4).
 * Only merge permanently after a fresh calibration rebuild confirms it beats
 * Stage 3 on Brier + ECE. Flip to false to instant-revert without a deploy.
 */
export const STAGE4_LOGNORMAL_ENABLED = true;

// ---------------------------------------------------------------------------

export type DistributionFamily = "normal" | "poisson" | "negbin" | "zip" | "lognormal";

// ---------------------------------------------------------------------------
// Stage 1 — Poisson stats
// ---------------------------------------------------------------------------

const POISSON_STATS = new Set<string>([
  "Home Runs",  // MLB — ~0.21/game, hard floor 0
  "Goals",      // NHL — ~0.42/game, Poisson event by definition
  "Pass TDs",   // NFL — ~1.50/game, discrete count
  "Rush TDs",   // NFL — ~0.55/game, rare per-game event
  "Rec TDs",    // NFL — ~0.42/game, rare per-game event
  "3-PT Made",  // NBA/WNBA — ~2.2/game, discrete makes
  "Triples",    // MLB — ~0.05/game, rarest non-HR hit type; hard floor 0
]);

// ---------------------------------------------------------------------------
// Stage 2 — Negative Binomial stats
// ---------------------------------------------------------------------------

/**
 * Overdispersed counting stats: variance > mean (bursty players).
 * r = mean²/(sigma²−mean) computed at runtime; Poisson fallback if sigma²≤mean.
 */
const NEGBIN_STATS = new Set<string>([
  "RBIs",               // MLB — 0-0-0-3-0 burst patterns
  "Hits",               // MLB — cold streaks + multi-hit games
  "Walks",              // MLB — pitcher-matchup dependent
  "Assists",            // NHL — playmaking chains
  "Doubles",            // MLB — park/matchup driven
  "Runs",               // MLB — clusters with lineup productivity
  "Singles",            // MLB — contact vs strikeout games
  "Total Bases",        // MLB — composite counting stat; overdispersed
  "Steals",             // NBA — discrete bursts; separate stat from MLB "Stolen Bases"
  "Hitter Strikeouts",  // MLB — pitcher-matchup bursty; discrete count with overdispersion
]);

// ---------------------------------------------------------------------------
// Stage 3 — Zero-Inflated Poisson stats
// ---------------------------------------------------------------------------

/**
 * Structural-zero probability π per stat family.
 * With probability π the player is in a "no-event" game state regardless
 * of their season rate. λ_eff = mean/(1−π) so E[X] = mean is preserved.
 */
const ZIP_P_ZERO: Record<string, number> = {
  "Stolen Bases":      0.15, // intent-based non-running games
  "Power Play Points": 0.20, // no PP unit assignment for the period
  "Blocked Shots":     0.10, // game state / matchup removes opportunities
};

const ZIP_STATS = new Set<string>(Object.keys(ZIP_P_ZERO));

// ---------------------------------------------------------------------------
// Stage 4 — Log-normal stats (guarded by flag)
// ---------------------------------------------------------------------------

/**
 * Right-skewed continuous yardage stats.
 * Log-normal fits these better than Normal because:
 *   - Hard floor at 0 (cannot go negative)
 *   - Right-skewed: a few blowup games lift the mean above the median
 *   - CV (sigma/mean) of 50–90% puts these firmly in log-normal territory
 *
 * Parameters derived from moment-matching:
 *   σ_log  = sqrt(ln(1 + (sigma/mean)²))
 *   μ_log  = ln(mean) − 0.5 × σ_log²
 */
const LOGNORMAL_STATS = new Set<string>([
  "Pass Yards",      // NFL — mean ~250, std ~65, CV ~26%
  "Rush Yards",      // NFL — mean ~70,  std ~42, CV ~60%
  "Receiving Yards", // NFL — mean ~58,  std ~36, CV ~62%
]);

// ---------------------------------------------------------------------------

export function getDistributionFamily(statType: string): DistributionFamily {
  if (POISSON_STATS.has(statType))                          return "poisson";
  if (NEGBIN_STATS.has(statType))                           return "negbin";
  if (ZIP_STATS.has(statType))                              return "zip";
  if (STAGE4_LOGNORMAL_ENABLED && LOGNORMAL_STATS.has(statType)) return "lognormal";
  return "normal";
}

// ---------------------------------------------------------------------------
// Poisson CDF  (Stage 1)
// ---------------------------------------------------------------------------

export function poissonCDF(lambda: number, k: number): number {
  if (lambda <= 0) return k < 0 ? 0 : 1;
  if (k < 0) return 0;
  let sum = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += term;
    term *= lambda / (i + 1);
  }
  return Math.min(1, sum);
}

export function pOverLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 0;
  return (1 - poissonCDF(lambda, Math.floor(line))) * 100;
}

export function percentileAtLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 100;
  return poissonCDF(lambda, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Negative Binomial CDF  (Stage 2)
// ---------------------------------------------------------------------------

export function negBinCDF(mu: number, r: number, k: number): number {
  if (mu <= 0) return k < 0 ? 0 : 1;
  if (k < 0) return 0;
  if (r <= 0) return poissonCDF(mu, k);
  const p = r / (r + mu);
  const q = 1 - p;
  let sum = 0;
  let term = Math.pow(p, r);
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += term;
    term *= (q * (r + i)) / (i + 1);
  }
  return Math.min(1, sum);
}

export function pOverLineNegBin(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 0;
  const overdispersion = sigma * sigma - mu;
  if (overdispersion <= 0.01 * mu) return pOverLinePoisson(mu, line);
  const r = (mu * mu) / overdispersion;
  return (1 - negBinCDF(mu, r, Math.floor(line))) * 100;
}

export function percentileAtLineNegBin(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 100;
  const overdispersion = sigma * sigma - mu;
  if (overdispersion <= 0.01 * mu) return percentileAtLinePoisson(mu, line);
  const r = (mu * mu) / overdispersion;
  return negBinCDF(mu, r, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Zero-Inflated Poisson CDF  (Stage 3)
// ---------------------------------------------------------------------------

/**
 * P(X ≤ k) for ZIP(mu, pZero).
 * CDF: π + (1−π) × PoissonCDF(λ_eff, k)  where λ_eff = mu/(1−pZero).
 */
export function zipCDF(mu: number, pZero: number, k: number): number {
  if (mu <= 0) return k < 0 ? 0 : 1;
  if (k < 0) return 0;
  return pZero + (1 - pZero) * poissonCDF(mu / (1 - pZero), k);
}

export function pOverLineZIP(mu: number, pZero: number, line: number): number {
  if (mu <= 0) return 0;
  return (1 - zipCDF(mu, pZero, Math.floor(line))) * 100;
}

export function percentileAtLineZIP(mu: number, pZero: number, line: number): number {
  if (mu <= 0) return 100;
  return zipCDF(mu, pZero, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Log-normal CDF  (Stage 4)
// ---------------------------------------------------------------------------

/**
 * P(X ≤ x) for X ~ LogNormal(μ_log, σ_log) parameterised by (mean, sigma).
 *
 * Moment-matching:
 *   σ_log = sqrt(ln(1 + (sigma/mean)²))
 *   μ_log = ln(mean) − 0.5 × σ_log²
 *
 * Note: uses the actual line value (not floor) because log-normal is
 * continuous — PP yards lines are already .5-offset integers (99.5, etc.)
 * so there is no ties problem.
 */
export function logNormalCDF(mu: number, sigma: number, x: number): number {
  if (x <= 0) return 0;
  if (mu <= 0 || sigma <= 0) return 0;
  const cv2      = (sigma / mu) ** 2;
  const sigmaLog = Math.sqrt(Math.log(1 + cv2));
  const muLog    = Math.log(mu) - 0.5 * sigmaLog * sigmaLog;
  const z        = (Math.log(x) - muLog) / sigmaLog;
  return normalCDF(z);
}

/** P(X > line) for LogNormal(mean, sigma), returned 0–100. */
export function pOverLineLognormal(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 0;
  return (1 - logNormalCDF(mu, sigma, line)) * 100;
}

/** P(X ≤ line) for LogNormal(mean, sigma), returned 0–100. */
export function percentileAtLineLognormal(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 100;
  return logNormalCDF(mu, sigma, line) * 100;
}

// ---------------------------------------------------------------------------
// Distribution-aware wrappers  (the single swap point for all consumers)
// ---------------------------------------------------------------------------

export function pOverLineDist(
  mean: number,
  sigma: number,
  line: number,
  statType: string,
): number {
  const family = getDistributionFamily(statType);
  if (family === "poisson")   return pOverLinePoisson(mean, line);
  if (family === "negbin")    return pOverLineNegBin(mean, sigma, line);
  if (family === "zip")       return pOverLineZIP(mean, ZIP_P_ZERO[statType] ?? 0.10, line);
  if (family === "lognormal") return pOverLineLognormal(mean, sigma, line);
  return pOverLine(mean, sigma, line);
}

export function percentileAtLineDist(
  mean: number,
  sigma: number,
  line: number,
  statType: string,
): number {
  const family = getDistributionFamily(statType);
  if (family === "poisson")   return percentileAtLinePoisson(mean, line);
  if (family === "negbin")    return percentileAtLineNegBin(mean, sigma, line);
  if (family === "zip")       return percentileAtLineZIP(mean, ZIP_P_ZERO[statType] ?? 0.10, line);
  if (family === "lognormal") return percentileAtLineLognormal(mean, sigma, line);
  return percentileAtLine(mean, sigma, line);
}

export { normalCDF };
