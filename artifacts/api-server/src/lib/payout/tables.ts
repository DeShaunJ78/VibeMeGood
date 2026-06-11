/**
 * Canonical PrizePicks payout tables.
 *
 * IMPORTANT: Keep these in sync with POWER_PAYOUTS and FLEX_PAYOUTS in
 * lib/analytics/src/pickem-math.ts, which the frontend uses for EV and
 * Kelly calculations. If PrizePicks changes their payout structure, update
 * BOTH files so the lineup optimizer and the entry builder agree.
 *
 * Power: { picks: multiplier }
 * Flex:  { totalPicks: { hits: multiplier } }
 */

export const POWER_PAYOUTS: Record<number, number> = {
  2: 3,
  3: 6,
  4: 10,
  5: 20,
  6: 37.5,  // was 40 — PrizePicks updated April 2026
};

export const FLEX_PAYOUTS: Record<number, Record<number, number>> = {
  3: { 3: 3,  2: 1.0 },           // was { 3:5, 2:1.25 }
  4: { 4: 6,  3: 1.5 },           // was { 4:10, 3:2.5 }
  5: { 5: 10, 4: 2,   3: 0.4 },  // was { 5:20, 4:4, 3:1 }
  6: { 6: 25, 5: 2,   4: 0.4 },  // was { 6:40, 5:6, 4:1.5, 3:1 } — 3/6 removed
};

/** Convenience lookup for `hits/total` string keys used across the optimizer. */
export function flexPayout(hits: number, total: number): number {
  return FLEX_PAYOUTS[total]?.[hits] ?? 0;
}
