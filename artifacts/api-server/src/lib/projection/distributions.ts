/**
 * Statistical distribution routing for PrizePicks prop modeling.
 *
 * Stage 1 (this file): Poisson for clean sparse counting stats.
 *   Home Runs, Goals, TDs, Stolen Bases, 3-PT Made.
 *
 * Stage 2 (future): Negative Binomial for messier sparse stats.
 *   RBIs, Hits, NHL Assists — mean > Poisson variance implies overdispersion.
 *
 * Stage 3 (future): Zero-Inflated Poisson for near-zero sparse stats.
 *   Power Play Points, Blocked Shots — structural zero excess.
 *
 * The swap point in compute.ts is:
 *   pOverLineDist(mean, sigma, line, statType)
 *   percentileAtLineDist(mean, sigma, line, statType)
 */

import { pOverLine, percentileAtLine, normalCDF } from "./normal-dist";

export type DistributionFamily = "normal" | "poisson";

/**
 * Stage 1 Poisson stats.
 * Keys MUST match exact canonical stat_type strings in player_game_logs.
 * Normal distribution is mathematically wrong for these — they are discrete
 * count events that cannot go negative and cluster near zero.
 */
const POISSON_STATS = new Set<string>([
  "Home Runs",    // MLB — ~0.21/game, right-skewed, hard floor at 0
  "Goals",        // NHL — ~0.42/game, Poisson event by definition
  "Stolen Bases", // MLB — ~0.18/game, rare discrete event
  "Pass TDs",     // NFL — ~1.50/game, discrete count
  "Rush TDs",     // NFL — ~0.55/game, rare per-game event
  "Rec TDs",      // NFL — ~0.42/game, rare per-game event
  "3-PT Made",    // NBA/WNBA — ~2.2/game, discrete makes count
]);

export function getDistributionFamily(statType: string): DistributionFamily {
  return POISSON_STATS.has(statType) ? "poisson" : "normal";
}

// ---------------------------------------------------------------------------
// Poisson CDF
// ---------------------------------------------------------------------------

/**
 * P(X ≤ k) for X ~ Poisson(lambda).
 * Uses iterative term computation — numerically stable for lambda < 1000.
 */
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

/**
 * P(X > line) for X ~ Poisson(lambda), returned as 0–100.
 *
 * PP lines are always .5 values (0.5, 1.5, 2.5 ...), so:
 *   P(X > 0.5) = P(X ≥ 1) = 1 − P(X ≤ 0) = 1 − poissonCDF(λ, 0)
 *   P(X > 1.5) = P(X ≥ 2) = 1 − poissonCDF(λ, 1)
 *   P(X > 2.5) = P(X ≥ 3) = 1 − poissonCDF(λ, 2)
 *
 * floor(line) gives the correct k for any .5-offset line.
 */
export function pOverLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 0;
  return (1 - poissonCDF(lambda, Math.floor(line))) * 100;
}

/**
 * P(X ≤ line) for X ~ Poisson(lambda), returned as 0–100.
 * "Where does the line sit in the distribution?"
 */
export function percentileAtLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 100;
  return poissonCDF(lambda, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Distribution-aware wrappers (the swap point in compute.ts)
// ---------------------------------------------------------------------------

/**
 * P(X > line) using the appropriate distribution for the stat type.
 * Returned as 0–100.
 *
 * For Poisson stats: uses the Poisson CDF with lambda = mean.
 * For all others: uses the normal CDF with (mean, sigma).
 */
export function pOverLineDist(
  mean: number,
  sigma: number,
  line: number,
  statType: string,
): number {
  const family = getDistributionFamily(statType);
  if (family === "poisson") return pOverLinePoisson(mean, line);
  return pOverLine(mean, sigma, line);
}

/**
 * Percentile at line using the appropriate distribution.
 * Returned as 0–100.
 */
export function percentileAtLineDist(
  mean: number,
  sigma: number,
  line: number,
  statType: string,
): number {
  const family = getDistributionFamily(statType);
  if (family === "poisson") return percentileAtLinePoisson(mean, line);
  return percentileAtLine(mean, sigma, line);
}

export { normalCDF };
