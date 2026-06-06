---
name: GPP Mode Design
description: Key design decisions for the GPP tournament optimization mode in the Lineup Factory
---

## Composite score formula
`(ceilingRating / ownershipEst) * safeEdge`
- `safeEdge = Math.max(0.1, edgeScore)` — intentional floor; GPP is ceiling-first not edge-first; negative-edge props can still offer contrarian leverage, floor prevents distortion
- `ceilingRating` defaults to 50 when null; `ownershipEst` defaults to 20 (clamped to ≥1)

## Leverage score formula
`(ceilingRating / 100) * expectedValue / (ownershipEst / 100)`
= ceiling EV / ownership — how much ceiling-adjusted dollar EV per unit of ownership taken on

## Sharp signal — direction-aware mapping
Stored `line_move_events.sharpSignal` is `sharp | public | neutral`.
Factory enrichment maps this to pick-direction-aware values before exposing on ScoredProp:
- `sharp` + `moveDirection=up` + pick=`more` → `sharp_for` (line moved up = sharp bet over = same as pick)
- `sharp` + `moveDirection=up` + pick=`less` → `sharp_against`
- `sharp` + `moveDirection=down` + pick=`more` → `sharp_against`
- `sharp` + `moveDirection=down` + pick=`less` → `sharp_for`
- `sharp` + no moveDirection → `sharp_for` (conservative assumption)
- `public` → `public`; `neutral` → `neutral`

`sharpAlignmentOnly` filter excludes `sharp_against` props.

## Narrative filter gate
Backend hard-gates all `gppNarrativeFilters` to `optimizationObjective === "gpp_mode"`.
Config object carrying `gppNarrativeFilters` without `gpp_mode` objective → filters silently skipped.

## Pace tier lookup
Queries `team_pace_ratings` filtered by (teamAbbr, sport), ordered DESC by season.
In-memory dedup keeps only the latest season per `abbr:sport` key to avoid stale/mixed-season data.
Thresholds: paceRating > 1.02 = fast, < 0.98 = slow, else normal.

## Ownership source
`crowd_ownership_snapshots` table holds real crowd % per (playerId, statType, slateDate, source).
Factory bulk-queries today's snapshots in section 2e; falls back to tier-based estimate when no real data.
`ownershipSource: "real" | "estimated"` surfaced on ScoredProp; frontend colors cyan for real data.

## GPP backtest
`GET /api/dashboard/gpp-backtest` splits entries on `optimizationObjective = 'gpp_mode'` vs all others.
Entry tagging: `entry-context.tsx` stores `optimizationObjective`; `lineup-factory.tsx` sets it when loading a lineup; `entry-builder.tsx` passes it to `createEntry`.

**Why:** These design invariants are not obvious from reading the code and caused multiple code-review cycles.
