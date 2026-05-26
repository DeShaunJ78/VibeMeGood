// ── Pick'em math library ──────────────────────────────────────────────────────
// All formulas are pick'em-specific: fixed payouts, joint probability only.
// EV = (∏ leg_probs) × multiplier − 1  (as a decimal; multiply by 100 for %)

export const ENTRY_TYPES: Record<string, { multiplier: number; breakEven: number }> = {
  "2-pick-power": { multiplier: 3,  breakEven: 0.5774 },
  "3-pick-power": { multiplier: 6,  breakEven: 0.5503 },
  "4-pick-power": { multiplier: 10, breakEven: 0.5623 },
  "5-pick-power": { multiplier: 12, breakEven: 0.5743 },
  "5-pick-flex":  { multiplier: 8,  breakEven: 0.5283 },
  "6-pick-power": { multiplier: 25, breakEven: 0.5743 },
  "6-pick-flex":  { multiplier: 15, breakEven: 0.5188 },
};

/**
 * Return the break-even per-leg hit rate for a given entry type key.
 * Returns 0.5 (coin flip) if the key is not found.
 */
export function getBreakEven(entryType: string): number {
  return ENTRY_TYPES[entryType]?.breakEven ?? 0.5;
}

/**
 * Return the entry-type key with the lowest per-leg break-even for this
 * leg count (i.e. the most favourable structure for the bettor).
 */
export function getOptimalEntryType(legCount: number): string {
  const candidates = Object.entries(ENTRY_TYPES).filter(([key]) =>
    key.startsWith(`${legCount}-pick-`),
  );
  if (candidates.length === 0) return `${legCount}-pick-power`;
  return candidates.reduce((best, cur) =>
    cur[1].breakEven < best[1].breakEven ? cur : best,
  )[0];
}

/**
 * Pick'em EV as a decimal fraction (e.g. 0.08 = 8% EV).
 * EV = (∏ legProbs) × multiplier − 1
 */
export function pickemEV(legProbs: number[], multiplier: number): number {
  if (legProbs.length === 0 || multiplier <= 0) return -1;
  const jointProb = legProbs.reduce((acc, p) => acc * p, 1);
  return jointProb * multiplier - 1;
}

// ── Payout-shift detection ────────────────────────────────────────────────────

export interface EntryLeg {
  playerName: string;
  teamAbbr?: string | null;
  statType: string;
  direction: "more" | "less";
  pHit?: number | null;
  gameId?: number | null;
}

// Stat-type buckets used for correlation detection (case-insensitive substrings)
const PASSING_KEYWORDS  = ["passing yard", "pass yard", "passing td", "completions"];
const RECEIVING_KEYWORDS = ["receiving yard", "rec yard", "receptions", "catches", "targets"];
const RUSHING_KEYWORDS   = ["rushing yard", "rush yard", "carries"];

function matchesBucket(statType: string, keywords: string[]): boolean {
  const lower = statType.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

function isPassing(s: string)   { return matchesBucket(s, PASSING_KEYWORDS); }
function isReceiving(s: string) { return matchesBucket(s, RECEIVING_KEYWORDS); }
function isRushing(s: string)   { return matchesBucket(s, RUSHING_KEYWORDS); }

interface PayoutShiftResult {
  hasShift: boolean;
  estimatedMultiplier: number;
  warning: string | null;
  tip: string | null;
  correlationReason: string | null;
}

/**
 * Detect whether the set of legs is likely to trigger a PrizePicks payout
 * shift due to positively or negatively correlated outcomes.
 *
 * @param legs       All legs in the entry.
 * @param fullMultiplier  The normal multiplier before any shift (e.g. 6 for 3-pick power).
 */
export function detectPayoutShift(
  legs: EntryLeg[],
  fullMultiplier: number,
): PayoutShiftResult {
  const noShift: PayoutShiftResult = {
    hasShift: false,
    estimatedMultiplier: fullMultiplier,
    warning: null,
    tip: null,
    correlationReason: null,
  };

  if (legs.length < 2) return noShift;

  // Group legs by team
  const byTeam = new Map<string, EntryLeg[]>();
  for (const leg of legs) {
    if (!leg.teamAbbr) continue;
    const key = leg.teamAbbr.toUpperCase();
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key)!.push(leg);
  }

  for (const [team, teamLegs] of byTeam) {
    if (teamLegs.length < 2) continue;

    const overs = teamLegs.filter(l => l.direction === "more");
    if (overs.length < 2) continue;

    // Check: two receivers on the same team both going over on receiving yards
    const receiverOvers = overs.filter(l => isReceiving(l.statType));
    if (receiverOvers.length >= 2) {
      const reducedMult = +(fullMultiplier * 0.92).toFixed(2);
      return {
        hasShift: true,
        estimatedMultiplier: reducedMult,
        warning: `⚠️ Payout shift likely — PrizePicks may reduce your multiplier from ${fullMultiplier}x to ~${reducedMult}x due to correlated legs (${team} receivers both over receiving yards). Actual EV may be lower than shown.`,
        tip: "To avoid payout shifts: mix teams, mix games, or take opposite sides on correlated players.",
        correlationReason: `Two ${team} receivers — both over receiving yards (strong positive correlation)`,
      };
    }

    // Check: passer + receiver same team both overs (passing yards + receiving yards)
    const passerOvers   = overs.filter(l => isPassing(l.statType));
    const wideReceivers = overs.filter(l => isReceiving(l.statType));
    if (passerOvers.length >= 1 && wideReceivers.length >= 1) {
      const reducedMult = +(fullMultiplier * 0.91).toFixed(2);
      return {
        hasShift: true,
        estimatedMultiplier: reducedMult,
        warning: `⚠️ Payout shift likely — PrizePicks may reduce your multiplier from ${fullMultiplier}x to ~${reducedMult}x due to correlated legs (${team} QB passing + WR receiving both over). Actual EV may be lower than shown.`,
        tip: "To avoid payout shifts: mix teams, mix games, or take opposite sides on correlated players.",
        correlationReason: `${team} QB passing yards + WR receiving yards — both over (strong positive correlation)`,
      };
    }

    // Check: negative correlation — QB rushing + WR receiving same team, both overs
    const qbRushOvers = overs.filter(l => isRushing(l.statType));
    if (qbRushOvers.length >= 1 && wideReceivers.length >= 1) {
      const reducedMult = +(fullMultiplier * 0.94).toFixed(2);
      return {
        hasShift: true,
        estimatedMultiplier: reducedMult,
        warning: `⚠️ Payout shift possible — PrizePicks may adjust your multiplier from ${fullMultiplier}x to ~${reducedMult}x. QB rushing yards and WR receiving yards on the same team are negatively correlated.`,
        tip: "To avoid payout shifts: mix teams, mix games, or take opposite sides on correlated players.",
        correlationReason: `${team} QB rushing yards + WR receiving yards — negative correlation`,
      };
    }
  }

  return noShift;
}
