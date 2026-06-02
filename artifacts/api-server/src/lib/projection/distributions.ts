/**
 * Statistical distribution routing for PrizePicks prop modeling.
 *
 * Stage 1 — Poisson: clean sparse counting stats where variance ≈ mean.
 *   Home Runs, Goals, TDs, Stolen Bases, 3-PT Made.
 *
 * Stage 2 — Negative Binomial: overdispersed counting stats where variance > mean.
 *   RBIs, Hits, Walks, NHL Assists, Doubles, Runs, Singles.
 *   NegBin admits variance = mean + mean²/r, fitting "bursty" players.
 *   Dispersion r is derived from moment-matching: r = mean²/(sigma²-mean).
 *   Falls back to Poisson automatically when sample variance ≤ mean.
 *
 * Stage 3 (future) — ZIP: near-zero sparse stats with structural zero excess.
 *   Power Play Points, Blocked Shots.
 *   Standard Poisson under-predicts P(X=0) for these stats.
 *
 * The swap point in compute.ts is:
 *   pOverLineDist(mean, sigma, line, statType)
 *   percentileAtLineDist(mean, sigma, line, statType)
 */

import { pOverLine, percentileAtLine, normalCDF } from "./normal-dist";

export type DistributionFamily = "normal" | "poisson" | "negbin";

// ---------------------------------------------------------------------------
// Distribution family routing maps
// ---------------------------------------------------------------------------

/**
 * Stage 1 — Poisson stats.
 * Keys MUST match exact canonical stat_type strings in player_game_logs.
 * Normal distribution is wrong for these — they are discrete count events
 * that cannot go negative and cluster near zero.
 */
const POISSON_STATS = new Set<string>([
  "Home Runs",    // MLB — ~0.21/game, right-skewed, hard floor at 0
  "Goals",        // NHL — ~0.42/game, Poisson event by definition
  "Stolen Bases", // MLB — ~0.18/game, rare discrete event (ZIP in Stage 3)
  "Pass TDs",     // NFL — ~1.50/game, discrete count
  "Rush TDs",     // NFL — ~0.55/game, rare per-game event
  "Rec TDs",      // NFL — ~0.42/game, rare per-game event
  "3-PT Made",    // NBA/WNBA — ~2.2/game, discrete makes count
]);

/**
 * Stage 2 — Negative Binomial stats.
 * These are overdispersed counting stats: variance > mean in practice.
 * Players can go cold for several games then explode — the "bursty" pattern
 * that Poisson (variance = mean) cannot model correctly.
 *
 * Dispersion r is computed dynamically from the blended (mean, sigma) at
 * projection time: r = mean²/(sigma²-mean). If sigma²≤mean the runtime
 * automatically falls back to Poisson, so no stat gets a worse fit.
 */
const NEGBIN_STATS = new Set<string>([
  "RBIs",      // MLB — highly bursty; 0-0-0-0-3-0 patterns are common
  "Hits",      // MLB — moderate overdispersion; cold streaks + multi-hit games
  "Walks",     // MLB — pitcher-matchup dependent; bursty by definition
  "Assists",   // NHL — very bursty; playmaking chains, not independent events
  "Doubles",   // MLB — rare and bursty; park/matchup driven
  "Runs",      // MLB — team-dependent; clusters with lineup productivity
  "Singles",   // MLB — moderate overdispersion; contact vs strikeout games
]);

export function getDistributionFamily(statType: string): DistributionFamily {
  if (POISSON_STATS.has(statType)) return "poisson";
  if (NEGBIN_STATS.has(statType)) return "negbin";
  return "normal";
}

// ---------------------------------------------------------------------------
// Poisson CDF  (Stage 1)
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
 * PP lines are always .5 values (0.5, 1.5, 2.5 …), so:
 *   P(X > 0.5) = P(X ≥ 1) = 1 − poissonCDF(λ, 0)
 *   P(X > 1.5) = P(X ≥ 2) = 1 − poissonCDF(λ, 1)
 *   floor(line) gives the correct k for any .5-offset line.
 */
export function pOverLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 0;
  return (1 - poissonCDF(lambda, Math.floor(line))) * 100;
}

/** P(X ≤ line) for X ~ Poisson(lambda), returned as 0–100. */
export function percentileAtLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 100;
  return poissonCDF(lambda, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Negative Binomial CDF  (Stage 2)
// ---------------------------------------------------------------------------

/**
 * P(X ≤ k) for X ~ NegBin(mu, r) parameterised by mean (mu) and dispersion (r).
 *
 * Relationship to standard NegBin(r, p):  p = r / (r + mu)
 * PMF:  P(X=0) = p^r
 *       P(X=i) = P(X=i-1) × (r+i-1)/i × (1-p)
 *
 * This iterative recurrence is numerically stable for the ranges we use
 * (mu up to ~10, r typically 2–20).
 */
export function negBinCDF(mu: number, r: number, k: number): number {
  if (mu <= 0) return k < 0 ? 0 : 1;
  if (k < 0) return 0;
  if (r <= 0) return poissonCDF(mu, k); // degenerate — fall through

  const p = r / (r + mu);   // success probability
  const q = 1 - p;          // = mu / (r + mu)

  let sum = 0;
  let term = Math.pow(p, r); // P(X = 0) = p^r
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += term;
    term *= (q * (r + i)) / (i + 1);
  }
  return Math.min(1, sum);
}

/**
 * P(X > line) for X ~ NegBin(mu, sigma), returned as 0–100.
 *
 * Dispersion r is derived from moment-matching:
 *   For NegBin: Var(X) = mu + mu²/r  →  r = mu² / (Var − mu)
 *
 * If sigma² ≤ mu (underdispersion or near-Poisson given the blended std),
 * falls back to Poisson so no stat ever gets a worse fit than Stage 1.
 */
export function pOverLineNegBin(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 0;
  const variance = sigma * sigma;
  const overdispersion = variance - mu;

  // Poisson fallback when variance ≤ mean (no overdispersion to model)
  if (overdispersion <= 0.01 * mu) return pOverLinePoisson(mu, line);

  const r = (mu * mu) / overdispersion;
  return (1 - negBinCDF(mu, r, Math.floor(line))) * 100;
}

/** P(X ≤ line) for X ~ NegBin(mu, sigma), returned as 0–100. */
export function percentileAtLineNegBin(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 100;
  const variance = sigma * sigma;
  const overdispersion = variance - mu;

  if (overdispersion <= 0.01 * mu) return percentileAtLinePoisson(mu, line);

  const r = (mu * mu) / overdispersion;
  return negBinCDF(mu, r, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Distribution-aware wrappers (the swap point in compute.ts)
// ---------------------------------------------------------------------------

/**
 * P(X > line) using the appropriate distribution for the stat type.
 * Returned as 0–100.
 *
 * Routing:
 *   Poisson stats  → Poisson CDF (lambda = mean; sigma ignored)
 *   NegBin stats   → NegBin CDF (r derived from mean + sigma via moment-matching;
 *                    auto-falls back to Poisson if sigma² ≤ mean)
 *   Everything else → Normal CDF (mean, sigma)
 */
export function pOverLineDist(
  mean: number,
  sigma: number,
  line: number,
  statType: string,
): number {
  const family = getDistributionFamily(statType);
  if (family === "poisson") return pOverLinePoisson(mean, line);
  if (family === "negbin")  return pOverLineNegBin(mean, sigma, line);
  return pOverLine(mean, sigma, line);
}

/**
 * Percentile at line using the appropriate distribution.
 * Returned as 0–100 ("where does the line sit?").
 */
export function percentileAtLineDist(
  mean: number,
  sigma: number,
  line: number,
  statType: string,
): number {
  const family = getDistributionFamily(statType);
  if (family === "poisson") return percentileAtLinePoisson(mean, line);
  if (family === "negbin")  return percentileAtLineNegBin(mean, sigma, line);
  return percentileAtLine(mean, sigma, line);
}

export { normalCDF };
