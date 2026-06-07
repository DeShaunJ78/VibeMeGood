---
name: Role stability scoring
description: How minutes-based role stability is computed and injected into the scoring pipeline.
---

The `minutes` column on `player_game_logs` is populated per-row for every statType logged per game. Since multiple statType rows exist per player per game, you must dedupe by `(playerId, gameDate)` before collecting the minutes list — otherwise a 30-minute game appears 5× and inflates the sample.

**How to apply:**
- In `recalcPropScores()` (external-odds.ts), add `minutes: playerGameLogsTable.minutes` to the allGameLogs select.
- Build `minutesByPlayer: Map<number, number[]>` after the dedup loop.
- Only classify when `minutesList.length >= 5`; skip for sports where minutes are null (baseball, football often have 0 or null).
- Store `minutesAvg`, `minutesStdDev`, `roleStability` in `prop_scores.reasoning` JSONB — never add DB columns for derived values that change every rescore.
- Slate route reads from `(score.reasoning as Record<string, unknown>)?.roleStability`.

**Thresholds:**
- `bench_volatile`: avg < 22 AND stdDev > 6 → +20 risk penalty
- `volatile`: stdDev > 6 (any avg) → +10 risk penalty
- `starter`: avg >= 30 (stdDev ≤ 6)
- `rotation`: everything else

**Why:** riskScore = max 100; cap it with `Math.min(100, ...)` after adding roleRiskPenalty.
