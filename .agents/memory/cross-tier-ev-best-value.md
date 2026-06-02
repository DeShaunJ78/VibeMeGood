---
name: Cross-tier EV best-value selection
description: How standard/demon/goblin "best value" is computed and the two traps that crown demon spuriously
---

# Cross-tier EV best-value (★ BEST badge)

Per player+stat group, each tier's EV = pHit × effectivePayoutMultiplier; the max-EV
sibling gets `bestTierInGroup`. Demon/goblin always recommend "over"; standard picks its
better side. EV_EPS=0.005 tie-break favors the lower-risk tier (standard < goblin < demon).
Only groups with >1 tier are flagged.

## Trap 1: multiplier and pHit must share ONE probability basis
**Why:** if pHit uses the calibrated pOver but the multiplier ratio is fed the RAW pOver
(or vice-versa), you manufacture a fake edge and demon dominates everywhere. Feed the SAME
calibrated pOver to both the standard anchor (standardPOverByPlayerStat) and the tier prob
passed to effectivePayoutMultiplier.

## Trap 2: never crown a tier on a synthetic-default multiplier
**Why:** demon/goblin with NO standard sibling AND no manual override fall back to arbitrary
tier defaults (demon 1.5 / goblin 0.75), which structurally favor demon regardless of
probability. **How to apply:** gate best-candidate eligibility on `multiplierTrustworthy` =
standard (exact 1.0) OR manual override present OR a standard sibling exists to anchor the
EV-fair ratio. With none, suppress the badge — no trustworthy ranking exists.

After both gates: surviving demon crowns are all anchored by a standard sibling (the
legitimate "demon still hits ~as often as standard but pays the 1.1 floor premium" case).
EV is recomputed in the projections sync; prop_scores stores evValue but no p_over column.
