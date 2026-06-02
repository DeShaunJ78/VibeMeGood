---
name: Priors key mismatch → DEFAULT_PRIOR inflation
description: All stat types that fell through to DEFAULT_PRIOR = { mean: 20, std: 8 } due to key mismatches, and how this inflated pOver via Bayesian shrinkage.
---

## The bug
`priors.ts` PRIORS keys didn't match canonical DB stat_type names. Every mismatch silently fell through to `DEFAULT_PRIOR = { mean: 20, std: 8 }`.

With `SHRINKAGE_K = 8` and `n = 15` games: `shrinkage_factor = 8/(8+15) = 0.348`.
Blended mean = `0.652 × per_game_actual + 0.348 × 20`.
For RBIs (actual 0.45/game): blended = `0.652×0.45 + 0.348×20 = 0.29 + 6.96 = 7.25`.
Then `pOverLine(7.25, 3.5, 0.5) ≈ 97%`.

This looked like a "cumulative window total" bug but was actually wrong Bayesian shrinkage.

## Affected stat types (before fix)
- MLB: `RBI` (key) → `RBIs` (DB); `Hits+Runs+RBI` → `Hits+Runs+RBIs`
- MLB missing: `Singles`, `Doubles`, `Triples`, `Home Runs`, `Stolen Bases`, `Hitter Strikeouts`
- NBA: `blocks` → `Blocked Shots`; `threes_made` normalization only covered "3-pointers made", not "3-PT Made"  
- NHL: `shots` → `Shots On Goal`; missing `Goal + Assist`, `Power Play Points`
- NFL: `passing yards` → `Pass Yards`; `rushing yards` → `Rush Yards`; generic `touchdowns` → `Pass TDs`/`Rush TDs`/`Rec TDs` missing

## Fix
Rewrote `priors.ts` (artifacts/api-server/src/lib/projection/priors.ts):
- All 41 canonical stat_type strings as keys (exact DB names)
- Correct per-game PP-eligible starter means anchored to actual DB averages
- DEFAULT_PRIOR lowered to `{ mean: 2.5, std: 3.0 }` — still not ideal but much less explosive
- Added cross-sport fallback loop in `getPrior()`

## Why DEFAULT_PRIOR = 2.5, std = 3.0
Old default `mean: 20` catastrophically inflated every unknown stat (pOverLine(20, 8, 0.5) ≈ 99.4%).
New default `mean: 2.5` is still wrong for extreme stats but doesn't cause 97%+ pOver for 0.5-line props.

## Rule
Any new stat type added to PP must also get an entry in PRIORS with the EXACT canonical stat_type name from `player_game_logs`. The second lookup path (lowercase) only helps if the PRIORS key is already lowercase.
