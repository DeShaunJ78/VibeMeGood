// ── Sampling functions ────────────────────────────────────────────────────

function boxMuller(): number {
  const u1 = Math.random() + 1e-12;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sampleNormal(mean: number, stdDev: number): number {
  return Math.max(0, mean + boxMuller() * stdDev);
}

export function sampleLognormal(mean: number, stdDev: number): number {
  if (mean <= 0) return 0;
  const cv2 = (stdDev / mean) ** 2;
  const sigma2 = Math.log(1 + cv2);
  const mu = Math.log(mean) - sigma2 / 2;
  return Math.max(0, Math.exp(mu + Math.sqrt(sigma2) * boxMuller()));
}

export function samplePoisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    return Math.max(0, Math.round(sampleNormal(lambda, Math.sqrt(lambda))));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function sampleGamma(shape: number, scale: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, scale) * Math.random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = boxMuller();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

export function sampleNegativeBinomial(mean: number, stdDev: number): number {
  if (mean <= 0) return 0;
  const variance = Math.max(stdDev * stdDev, mean + 0.01);
  if (variance <= mean) return samplePoisson(mean);
  const r = (mean * mean) / (variance - mean);
  const gammaSample = sampleGamma(Math.max(r, 0.1), mean / Math.max(r, 0.1));
  return samplePoisson(Math.max(0, gammaSample));
}

// ── Standard deviation with fallback ─────────────────────────────────────

export function computeStdDev(gameLogs: number[]): number {
  if (gameLogs.length < 5) {
    const mean = gameLogs.length > 0
      ? gameLogs.reduce((a, b) => a + b, 0) / gameLogs.length
      : 0;
    return mean * 0.35;
  }
  const mean = gameLogs.reduce((a, b) => a + b, 0) / gameLogs.length;
  const variance = gameLogs.reduce((a, b) => a + (b - mean) ** 2, 0) / gameLogs.length;
  return Math.sqrt(variance);
}

// ── Distribution map ──────────────────────────────────────────────────────

export type DistType = "normal" | "lognormal" | "poisson" | "negative_binomial";

const DISTRIBUTION_MAP: Record<string, Record<string, DistType>> = {
  NBA: {
    "Points": "normal",
    "Rebounds": "normal",
    "Assists": "normal",
    "3-PT Made": "poisson",
    "Steals": "poisson",
    "Blocks": "poisson",
    "Pts+Rebs+Asts": "normal",
    "Pts+Asts": "normal",
    "Pts+Rebs": "normal",
    "Rebs+Asts": "normal",
    "Turnovers": "poisson",
  },
  NFL: {
    "Passing Yards": "lognormal",
    "Rushing Yards": "lognormal",
    "Receiving Yards": "lognormal",
    "Touchdowns": "poisson",
    "Receptions": "normal",
    "Pass Completions": "normal",
    "Pass Attempts": "normal",
  },
  MLB: {
    "Hits": "negative_binomial",
    "Home Runs": "poisson",
    "RBIs": "negative_binomial",
    "Strikeouts": "negative_binomial",
    "Walks": "poisson",
    "Total Bases": "negative_binomial",
    "Runs": "negative_binomial",
  },
  NHL: {
    "Goals": "poisson",
    "Assists": "poisson",
    "Shots on Goal": "negative_binomial",
    "Points": "normal",
    "Power Play Points": "poisson",
    "Saves": "negative_binomial",
  },
};

export function getDistribution(sport: string, statType: string): DistType {
  const upper = sport.toUpperCase();
  const sportMap = DISTRIBUTION_MAP[upper] ?? {};
  if (sportMap[statType]) return sportMap[statType];
  const lower = statType.toLowerCase();
  for (const [key, dist] of Object.entries(sportMap)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return dist;
    }
  }
  return "normal";
}

export function sampleDistribution(
  dist: DistType,
  mean: number,
  stdDev: number,
): number {
  switch (dist) {
    case "normal":           return sampleNormal(mean, stdDev);
    case "lognormal":        return sampleLognormal(mean, stdDev);
    case "poisson":          return samplePoisson(mean);
    case "negative_binomial": return sampleNegativeBinomial(mean, stdDev);
  }
}

// Correlated sample: shifts mean by `u` standard deviations (used in simulation loop)
export function sampleCorrelated(
  dist: DistType,
  mean: number,
  stdDev: number,
  u: number,
): number {
  switch (dist) {
    case "normal":
      return Math.max(0, mean + u * stdDev);
    case "lognormal": {
      if (mean <= 0) return 0;
      const cv2 = (stdDev / mean) ** 2;
      const sigma2 = Math.log(1 + cv2);
      const mu = Math.log(mean) - sigma2 / 2;
      return Math.max(0, Math.exp(mu + Math.sqrt(sigma2) * u));
    }
    case "poisson":
    case "negative_binomial":
      return Math.max(0, mean + u * Math.sqrt(mean));
  }
}
