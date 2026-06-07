---
name: prior_only pOver must be null
description: prior_only projections produce garbage pOver values that falsely crown props as PLAY; must be nulled before scoring.
---

## Rule
In `recalcPropScores` (external-odds.ts), when `sourceLabel === "prior_only"`, set `pOver = null`. Never pass `pOverRaw` through for prior-only projections.

**Why:** A prior_only projection means the model had no real game-log data — the result is driven entirely by DEFAULT_PRIOR `{ mean: 2.5, std: 3.0 }`. For low-line props (e.g. Home Runs @ 0.5, Blocked Shots @ 0.5), `pOverLine(2.5, 3.0, 0.5)` = ~79%, and after Bayesian shrinkage against sparse logs, this inflates to 90–99%. A 95% pOver gets tagged PLAY and floated to the top of the slate — a completely fake signal.

**How to apply:**
- In `recalcPropScores`: `let pOver = (pOverRaw !== null && sourceLabel !== "prior_only") ? calibratePOver(...) : null;`
- In `standardPOverByPlayerStat` construction loop: `if (proj.sourceLabel === "prior_only") continue;`
- Thin-data sanity gate (belt-and-suspenders): if `logCount < 5 && (pOver > 92 || pOver < 8)` → null pOver + log warn.

## normalizeStatType in all lookup paths
Also must call `normalizeStatType(line.statType)` before every `projByPlayerStat.get(...)` and `standardPOverByPlayerStat.get/set(...)` call. Without normalization, "Pts+Ast" ≠ "Pts+Asts" and the projection is not found → sourceLabel defaults to "prior_only" → null pOver (safe, but we lose a valid projection unnecessarily).

- Normalize `p.statType` when *building* `projByPlayerStat` map.
- Normalize `line.statType` as `normalizedStat` at the top of the per-line scoring block and use it for all subsequent map lookups and the `calibratePOver` call.
