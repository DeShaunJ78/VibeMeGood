/**
 * Normal distribution math for projection probability computation.
 * Uses Abramowitz & Stegun erfc approximation (max error 1.5e-7).
 */

function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    t * (0.254829592 +
    t * (-0.284496736 +
    t * (1.421413741 +
    t * (-1.453152027 +
    t * 1.061405429))));
  const result = poly * Math.exp(-x * x);
  return x >= 0 ? result : 2 - result;
}

/** Standard normal CDF: P(Z <= z) */
export function normalCDF(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** P(X > line) for N(mu, sigma) — returned as 0–100 */
export function pOverLine(mu: number, sigma: number, line: number): number {
  if (sigma <= 0) return mu > line ? 100 : 0;
  return (1 - normalCDF((line - mu) / sigma)) * 100;
}

/** Where the line sits in the distribution as a percentile (0–100) */
export function percentileAtLine(mu: number, sigma: number, line: number): number {
  if (sigma <= 0) return mu > line ? 0 : 100;
  return normalCDF((line - mu) / sigma) * 100;
}

/**
 * Confidence interval width — how wide is the ±1σ band as % of the line.
 * Smaller = tighter = more predictable player.
 */
export function volatilityPct(sigma: number, line: number): number {
  if (line <= 0) return 100;
  return (sigma / line) * 100;
}
