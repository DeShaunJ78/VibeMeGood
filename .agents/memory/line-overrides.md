---
name: pp_lines manual overrides (lineValueOverride / payoutMultiplier)
description: How corrected lines + demon/goblin payout multipliers are stored and consumed; why they survive resync.
---

`pp_lines` has nullable `lineValueOverride` (corrected PP line) and `payoutMultiplier` (manual demon/goblin payout). Overrides are keyed per **ppLineId**, never per playerId:statType.

**Why per-ppLineId:** keying corrections by playerId:statType caused override-bleed — correcting a standard line changed its goblin/demon siblings (same player+stat). Each tier is its own pp_lines row, so corrections must be per-row.

**Why they survive resync:** the PrizePicks sync upsert path only touches timestamps on existing rows; it must never write the two override columns, or a resync would wipe user corrections.

**Effective-line rule:** anywhere you evaluate a projection against a line (pOver, percentile, projectionGap, optimizer probability, charts) use `lineValueOverride ?? lineValue`, not raw `lineValue`. This applies to both the slate list route AND the `/slate/:ppLineId` detail route and the frontend slate-board cells/sorts.

**Effective multiplier rule:** `effectivePayoutMultiplier` = manual `payoutMultiplier` if set, else EV-preserving estimate `standardPOver/tierPOver` clamped (demon 1.1–3.0 default 1.5, goblin 0.4–0.95 default 0.75). The optimizer threads this through single-prop EV, calcPowerEV, calcFlexEV (payoutFactor param), and grossPayout.
