---
name: Calibration pseudo-line zero-median trap
description: The calibration job used median(priorVals) as the pseudo-line, which equals 0 for sparse stats, and the push-exclusion removed all "under" outcomes, creating a 100% hit rate artifact.
---

## The bug
`calibration-job.ts` computed `line = median(priorVals)` as the pseudo-book-line.

For sparse counting stats (Goals, RBIs, TDs, HR, Walks, Blocked Shots, etc.), >50–98% of game values are 0, so `median = 0`. Then `if (curValue === line) continue` excluded EVERY value=0 game, which ARE the legitimate "under" outcomes. Remaining observations were all value>0 — trivially hitting "over 0" → 100% hit rate by mathematical identity.

**Proof from data:** Player 17 RBIs — 50 games: 30 zeros (60%), 20 positives. median=0. Push exclusion removes 30 zeros. 20/20 remaining are "overs" = 100% hit rate.

**Scope:** 17 stat types had median=0 in game logs.

## The fix
Changed `line = median(priorVals)` to `line = median(priorVals) + 0.5`.

This mirrors real PP line-setting (0.5, 1.5, 2.5 for counting stats). Integer values never equal a .5 line, so the push exclusion is a no-op. value=0 correctly counts as an under, value≥1 as an over.

After fix:
- ECE: 10.87% → 9.34%
- Max calibration error: 26.4% → 16.8%
- The spurious 98.9% hit rate in 70–75% over bucket disappeared

## Residual pattern revealed
After fix, the calibration shows a systematic directional bias:
- Over direction: model predicts avg 60.6%, actual 50.8% (over-confident by ~10%)
- Under direction: model predicts avg 65.4%, actual 71.1% (under-confident by ~6%)

Root cause: player stat distributions are right-skewed (hard floor at 0), but the model assumes symmetric normal. This is a structural model limitation, not a code bug.

## Important: stale calibration rows
The `onConflictDoUpdate` only updates rows with matching keys. When the pseudo-line changes, the edge bucket key changes (e.g. MLB RBIs moved from "20-25 over" to "0-5 under"). MUST TRUNCATE the calibration table before re-running after any pseudo-line change:
```sql
TRUNCATE probability_calibration;
```
Then re-run: `pnpm --filter @workspace/api-server run calibrate`
