---
name: Probability calibration data source
description: Where the empirical hit-rate calibration comes from and why.
---

Calibration buckets (sport, statType, lineType, edgeBucket, direction → empirical
hit rate) are built by a walk-forward replay over `player_game_logs` (prior-only,
no leakage), evaluating the model's raw normal-CDF P(over) against a trailing
median pseudo-line and the actual outcome. Only the "standard" line tier is
reconstructed; goblin/demon fall through to raw P(over).

**Why this source, not real historical PP lines:** the only `pp_lines` carrying a
`game_id` point at unplayed future slate games (game-log history ends before
them), and historical inactive lines have no `game_id`. So real line→outcome
linkage does not exist. Game logs are the only settled-outcome data we have.

**Self-feeding:** game results arrive automatically via the stats sync, projections
recompute 3×/day, and the calibration table rebuilds weekly (cron Sun 5AM). No
manual data entry is required.

**Known skew finding:** replaying mean-vs-median produces a strong directional
asymmetry (model "over" calls hit far below 50%, "under" calls well above) — this
is the over-confidence the calibration is meant to correct, captured per
direction. Real PP lines sit nearer the mean than the median, so treat the
absolute bucket rates as a correction signal, not ground truth.
