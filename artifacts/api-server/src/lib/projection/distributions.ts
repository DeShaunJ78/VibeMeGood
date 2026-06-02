/**
 * Statistical distribution routing for PrizePicks prop modeling.
 *
 * Stage 1 — Poisson: clean sparse counting stats where variance ≈ mean.
 *   Home Runs, Goals, TDs, 3-PT Made.
 *
 * Stage 2 — Negative Binomial: overdispersed counting stats where variance > mean.
 *   RBIs, Hits, Walks, NHL Assists, Doubles, Runs, Singles.
 *   Dispersion r derived dynamically: r = mean²/(sigma²−mean).
 *   Falls back to Poisson when sample is underdispersed.
 *
 * Stage 3 — Zero-Inflated Poisson: structurally zero-inflated stats.
 *   Stolen Bases, Power Play Points, Blocked Shots.
 *   Player often has a true "not in role tonight" game state (no steal intent,
 *   no PP time, game situation removes block opportunities).  Standard Poisson
 *   under-predicts P(X=0) for these.  ZIP adds a structural-zero mixture
 *   component π per stat family.
 *
 * Stage 4 (future) — Log-normal / NB large-r for yards stats.
 *
 * The swap point is:
 *   pOverLineDist(mean, sigma, line, statType)       — returns 0–100
 *   percentileAtLineDist(mean, sigma, line, statType) — returns 0–100
 */

import { pOverLine, percentileAtLine, normalCDF } from "./normal-dist";

export type DistributionFamily = "normal" | "poisson" | "negbin" | "zip";

// ---------------------------------------------------------------------------
// Stage 1 — Poisson stats
// ---------------------------------------------------------------------------

/**
 * Discrete count events where variance ≈ mean.
 * Keys MUST match exact canonical stat_type strings in player_game_logs.
 */
const POISSON_STATS = new Set<string>([
  "Home Runs",  // MLB — ~0.21/game, hard floor 0
  "Goals",      // NHL — ~0.42/game, Poisson event by definition
  "Pass TDs",   // NFL — ~1.50/game, discrete count
  "Rush TDs",   // NFL — ~0.55/game, rare per-game event
  "Rec TDs",    // NFL — ~0.42/game, rare per-game event
  "3-PT Made",  // NBA/WNBA — ~2.2/game, discrete makes
]);

// ---------------------------------------------------------------------------
// Stage 2 — Negative Binomial stats
// ---------------------------------------------------------------------------

/**
 * Overdispersed counting stats: variance > mean.  Players go cold for runs
 * then explode — the "bursty" pattern Poisson cannot model.
 *
 * r = mean²/(sigma²−mean) is computed at runtime from the blended
 * (mean, sigma).  Falls back to Poisson automatically when sigma²≤mean
 * so no stat ever gets a worse fit than Stage 1.
 */
const NEGBIN_STATS = new Set<string>([
  "RBIs",     // MLB — 0-0-0-0-3-0 burst patterns
  "Hits",     // MLB — cold streaks + multi-hit games
  "Walks",    // MLB — pitcher-matchup dependent
  "Assists",  // NHL — playmaking chains, not independent events
  "Doubles",  // MLB — park/matchup driven
  "Runs",     // MLB — clusters with lineup productivity
  "Singles",  // MLB — contact vs strikeout games
]);

// ---------------------------------------------------------------------------
// Stage 3 — Zero-Inflated Poisson stats
// ---------------------------------------------------------------------------

/**
 * Structural-zero probability per stat family (π in the ZIP mixture).
 *
 * Interpretation: with probability π the player is in a true "no-event"
 * game state regardless of their season rate (no steal intent, no PP
 * assignment, game situation removes block opportunities).  The remaining
 * (1-π) fraction of games follow a Poisson with λ = mean/(1-π) so that
 * the overall E[X] = (1-π)·λ = mean is preserved.
 *
 * Values are conservative first estimates from domain reasoning.
 * Tuning: run calibrate.ts after enough new data accumulates; compare
 * observed P(X=0) vs ZIP P(X=0) in the 0-10% edge bucket per stat.
 */
const ZIP_P_ZERO: Record<string, number> = {
  "Stolen Bases":      0.15, // intent-based non-running games (~15%)
  "Power Play Points": 0.20, // no PP unit assignment for the period (~20%)
  "Blocked Shots":     0.10, // game state / matchup removes opportunities (~10%)
};

const ZIP_STATS = new Set<string>(Object.keys(ZIP_P_ZERO));

// ---------------------------------------------------------------------------

export function getDistributionFamily(statType: string): DistributionFamily {
  if (POISSON_STATS.has(statType)) return "poisson";
  if (NEGBIN_STATS.has(statType))  return "negbin";
  if (ZIP_STATS.has(statType))     return "zip";
  return "normal";
}

// ---------------------------------------------------------------------------
// Poisson CDF  (Stage 1)
// ---------------------------------------------------------------------------

/**
 * P(X ≤ k) for X ~ Poisson(lambda).
 * Iterative term computation — numerically stable for lambda < 1000.
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
 * P(X > line) for Poisson(lambda), returned 0–100.
 * PP lines are .5-offset so floor(line) = correct threshold k.
 */
export function pOverLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 0;
  return (1 - poissonCDF(lambda, Math.floor(line))) * 100;
}

/** P(X ≤ line) for Poisson(lambda), returned 0–100. */
export function percentileAtLinePoisson(lambda: number, line: number): number {
  if (lambda <= 0) return 100;
  return poissonCDF(lambda, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Negative Binomial CDF  (Stage 2)
// ---------------------------------------------------------------------------

/**
 * P(X ≤ k) for X ~ NegBin(mu, r) parameterised by mean and dispersion.
 *
 * p = r/(r+mu),  q = 1-p = mu/(r+mu)
 * P(X=0) = p^r
 * P(X=i) = P(X=i-1) × q×(r+i-1)/i   (iterative recurrence)
 */
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

/**
 * P(X > line) for NegBin(mu, sigma), returned 0–100.
 *
 * Dispersion r = mu²/(sigma²−mu).
 * Falls back to Poisson if sigma²≤mu (underdispersed per blended estimate).
 */
export function pOverLineNegBin(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 0;
  const variance = sigma * sigma;
  const overdispersion = variance - mu;
  if (overdispersion <= 0.01 * mu) return pOverLinePoisson(mu, line);
  const r = (mu * mu) / overdispersion;
  return (1 - negBinCDF(mu, r, Math.floor(line))) * 100;
}

/** P(X ≤ line) for NegBin(mu, sigma), returned 0–100. */
export function percentileAtLineNegBin(mu: number, sigma: number, line: number): number {
  if (mu <= 0) return 100;
  const variance = sigma * sigma;
  const overdispersion = variance - mu;
  if (overdispersion <= 0.01 * mu) return percentileAtLinePoisson(mu, line);
  const r = (mu * mu) / overdispersion;
  return negBinCDF(mu, r, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Zero-Inflated Poisson CDF  (Stage 3)
// ---------------------------------------------------------------------------

/**
 * P(X ≤ k) for X ~ ZIP(mu, pZero).
 *
 * ZIP mixture:
 *   With probability pZero  → structural zero (not in role)
 *   With probability 1-pZero → Poisson(lambda_eff) where lambda_eff = mu/(1-pZero)
 *
 * This preserves E[X] = mu regardless of pZero.
 *
 * CDF: P(X ≤ k) = pZero + (1-pZero) × PoissonCDF(lambda_eff, k)  for k ≥ 0
 */
export function zipCDF(mu: number, pZero: number, k: number): number {
  if (mu <= 0) return k < 0 ? 0 : 1;
  if (k < 0) return 0;
  const lambdaEff = mu / (1 - pZero); // effective rate for the active component
  return pZero + (1 - pZero) * poissonCDF(lambdaEff, k);
}

/**
 * P(X > line) for ZIP(mu, pZero), returned 0–100.
 *
 * P(X > line) = (1-pZero) × P(Poisson(lambda_eff) > line)
 * = (1-pZero) × pOverLinePoisson(lambda_eff, line) / 100 × 100
 */
export function pOverLineZIP(mu: number, pZero: number, line: number): number {
  if (mu <= 0) return 0;
  const lambdaEff = mu / (1 - pZero);
  return (1 - zipCDF(mu, pZero, Math.floor(line))) * 100;
}

/** P(X ≤ line) for ZIP(mu, pZero), returned 0–100. */
export function percentileAtLineZIP(mu: number, pZero: number, line: number): number {
  if (mu <= 0) return 100;
  return zipCDF(mu, pZero, Math.floor(line)) * 100;
}

// ---------------------------------------------------------------------------
// Distribution-aware wrappers  (the swap point for all consumers)
// ---------------------------------------------------------------------------

/**
 * P(X > line) using the appropriate distribution for the stat type.
 * Returned as 0–100.
 *
 *   Poisson → Poisson CDF  (lambda = mean; sigma unused)
 *   NegBin  → NegBin CDF   (r from moment-matching; Poisson fallback if underdispersed)
 *   ZIP     → ZIP CDF       (pZero from ZIP_P_ZERO table; lambda_eff = mean/(1-pZero))
 *   Normal  → normal CDF    (mean, sigma)
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
  if (family === "zip") {
    const pZero = ZIP_P_ZERO[statType] ?? 0.10;
    return pOverLineZIP(mean, pZero, line);
  }
  return pOverLine(mean, sigma, line);
}

/**
 * Percentile at line using the appropriate distribution.
 * Returned as 0–100 ("where does this line sit in the distribution?").
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
  if (family === "zip") {
    const pZero = ZIP_P_ZERO[statType] ?? 0.10;
    return percentileAtLineZIP(mean, pZero, line);
  }
  return percentileAtLine(mean, sigma, line);
}

export { normalCDF };
