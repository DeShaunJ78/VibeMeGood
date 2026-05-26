export interface LegContext {
  sport: string;
  team: string;
  gameId: string;
  statType: string;
  position?: string;
}

function pairCorrelation(a: LegContext, b: LegContext): number {
  if (!a.gameId || !b.gameId || a.gameId !== b.gameId) return 0;

  const sport = a.sport.toUpperCase();
  const sameTeam = a.team !== "" && a.team === b.team;
  const aPos = (a.position ?? "").toUpperCase();
  const bPos = (b.position ?? "").toUpperCase();
  const aStat = a.statType.toLowerCase();
  const bStat = b.statType.toLowerCase();

  if (sport === "NFL") {
    if (sameTeam) {
      if ((aPos === "QB" && bPos === "WR") || (aPos === "WR" && bPos === "QB")) return 0.65;
      if ((aPos === "QB" && bPos === "TE") || (aPos === "TE" && bPos === "QB")) return 0.55;
      if (aPos === "QB" && bPos === "QB") {
        const aRush = aStat.includes("rush");
        const aPass = aStat.includes("pass");
        const bRush = bStat.includes("rush");
        const bPass = bStat.includes("pass");
        if ((aRush && bPass) || (aPass && bRush)) return -0.30;
      }
      if (aPos === "WR" && bPos === "WR") return -0.25;
      if ((aPos === "RB" && bPos === "WR") || (aPos === "WR" && bPos === "RB")) return -0.15;
    }
    return 0.30;
  }

  if (sport === "NBA") {
    if (sameTeam) return 0.40;
    return 0.30;
  }

  if (sport === "MLB") {
    if (sameTeam) return 0.45;
    return 0.10;
  }

  if (sport === "NHL") {
    if (sameTeam) return 0.50;
    return 0.10;
  }

  return 0;
}

export function buildCorrelationMatrix(legs: LegContext[]): number[][] {
  const n = legs.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 1 : pairCorrelation(legs[i], legs[j]),
    ),
  );
}

export function getCorrelationPairs(
  legs: LegContext[],
): Array<{ i: number; j: number; corr: number }> {
  const n = legs.length;
  const pairs: Array<{ i: number; j: number; corr: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const corr = pairCorrelation(legs[i], legs[j]);
      if (Math.abs(corr) > 0.05) pairs.push({ i, j, corr });
    }
  }
  return pairs;
}

// Cholesky decomposition — returns L such that L · Lᵀ = matrix
// If matrix is not positive definite, nudges the diagonal until it is.
export function choleskyDecompose(matrix: number[][]): number[][] {
  const n = matrix.length;
  // Work on a copy with diagonal nudging if needed
  const A = matrix.map(row => [...row]);

  for (let attempt = 0; attempt < 5; attempt++) {
    const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let ok = true;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];

        if (i === j) {
          const val = A[i][i] - sum;
          if (val <= 0) { ok = false; break; }
          L[i][j] = Math.sqrt(val);
        } else {
          L[i][j] = L[j][j] === 0 ? 0 : (A[i][j] - sum) / L[j][j];
        }
      }
      if (!ok) break;
    }

    if (ok) return L;

    // Nudge diagonal
    const nudge = 0.01 * (attempt + 1);
    for (let i = 0; i < n; i++) A[i][i] += nudge;
  }

  // Fallback: identity (uncorrelated)
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}

// Generate correlated standard-normal samples using pre-computed Cholesky factor L
export function correlatedNormals(L: number[][]): number[] {
  const n = L.length;
  const z = Array.from({ length: n }, () => {
    const u1 = Math.random() + 1e-12;
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  });
  return Array.from({ length: n }, (_, i) => {
    let val = 0;
    for (let k = 0; k <= i; k++) val += L[i][k] * z[k];
    return val;
  });
}
