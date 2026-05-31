// Demon/goblin payout multiplier model (hybrid: automatic estimate + manual override).
//
// PrizePicks pays MORE for demon lines (harder) and LESS for goblin lines (easier),
// but their public projections feed does not expose the per-line multiplier — only the
// tier (`odds_type`). So we estimate it, and let the user override per line.
//
// Automatic estimate = EV-preserving ratio of the standard tier's hit probability to
// this tier's hit probability. If a standard line at p=0.50 becomes a demon at p=0.35,
// a fair boost that keeps EV constant is 0.50 / 0.35 ≈ 1.43×. Clamped to realistic
// PrizePicks ranges, with a tier default when no standard sibling exists.

const DEMON_MIN = 1.1;
const DEMON_MAX = 3.0;
const DEMON_DEFAULT = 1.5;
const GOBLIN_MIN = 0.4;
const GOBLIN_MAX = 0.95;
const GOBLIN_DEFAULT = 0.75;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Automatic, EV-preserving estimate of a demon/goblin payout multiplier.
 * @param lineType standard | goblin | demon
 * @param tierPOver hit probability (0..1) of THIS line
 * @param standardPOver hit probability (0..1) of the player/stat's standard line, if known
 * @returns multiplier where standard = 1.0
 */
export function estimatePayoutMultiplier(
  lineType: string,
  tierPOver: number | null | undefined,
  standardPOver: number | null | undefined,
): number {
  if (lineType !== "demon" && lineType !== "goblin") return 1.0;

  const haveRatio =
    typeof tierPOver === "number" && tierPOver > 0.01 &&
    typeof standardPOver === "number" && standardPOver > 0.01;

  if (lineType === "demon") {
    if (!haveRatio) return DEMON_DEFAULT;
    return Math.round(clamp(standardPOver! / tierPOver!, DEMON_MIN, DEMON_MAX) * 100) / 100;
  }
  // goblin
  if (!haveRatio) return GOBLIN_DEFAULT;
  return Math.round(clamp(standardPOver! / tierPOver!, GOBLIN_MIN, GOBLIN_MAX) * 100) / 100;
}

/**
 * Effective multiplier: manual override wins, else the automatic estimate.
 */
export function effectivePayoutMultiplier(
  manual: number | null | undefined,
  lineType: string,
  tierPOver: number | null | undefined,
  standardPOver: number | null | undefined,
): number {
  if (typeof manual === "number" && manual > 0) return manual;
  return estimatePayoutMultiplier(lineType, tierPOver, standardPOver);
}
