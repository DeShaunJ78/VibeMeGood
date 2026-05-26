export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export interface PlayerRef { id: number; fullName: string; sport: string }

export function matchPlayer(scrapedName: string, players: PlayerRef[]): PlayerRef | null {
  const norm = normalizeName(scrapedName);

  // 1. Exact match
  const exact = players.find(p => normalizeName(p.fullName) === norm);
  if (exact) return exact;

  // 2. Levenshtein ≤ 2
  let bestDist = 3;
  let bestMatch: PlayerRef | null = null;
  for (const p of players) {
    const d = levenshtein(norm, normalizeName(p.fullName));
    if (d < bestDist) { bestDist = d; bestMatch = p; }
  }
  if (bestMatch && bestDist <= 2) return bestMatch;

  // 3. Last name + first initial fallback
  const parts = norm.split(" ");
  const firstInit = parts[0]?.[0];
  const last = parts[parts.length - 1];
  for (const p of players) {
    const pp = normalizeName(p.fullName).split(" ");
    if (pp[pp.length - 1] === last && pp[0]?.[0] === firstInit) return p;
  }

  return null;
}
