# How VibeMeGood Scores Props

## The Projection Pipeline
1. PrizePicks sync pulls live lines every
   10 minutes (every minute near lock time)
2. Projection engine computes P(Over) using:
   - Weighted recent game logs (last 20 games,
     exponential decay — recent games count more)
   - Bayesian shrinkage toward population prior
     when sample is small
   - Opponent adjustment from matchup history
   - Injury check (OUT = NO-PLAY immediately)
   - Line type adjustment (goblin/demon/standard)
3. External odds sync pulls sportsbook lines
   and computes no-vig probability
4. Prop scoring runs 4-Gate formula
5. Market Intel API serves everything to
   Slate Board in one response

## MLB Park Factors
MLB batting projections are adjusted for
home ballpark:
Coors Field (COL): +18% — extreme hitter park
Great American Ball Park (CIN): +12%
Fenway Park (BOS): +8%
Oracle Park (SF): -10%
Petco Park (SD): -12%
This means a hitter playing in Colorado
gets an 18% boost to their projected stat.
A hitter playing in San Diego gets 12% cut.
Only applies to batting stats
(hits, home runs, total bases, RBIs, runs).
Not applied to pitching stats.

## Data Quality Score (DQ)
Every projection has a DQ score 0-100.
Starts at 100 and deductions applied:
-20: fewer than 6 game logs
-10: partial sample vs full confidence minimum
-10: no opponent matchup history
-30: GTD injury status
-60: OUT injury status
Below 25 DQ = NO-PLAY forced regardless
of edge score.

## Why Only 50-ish PLAY Props?
On a 15,000 prop slate only ~50 earn PLAY.
This is intentional and correct.
The three simultaneous gates are strict:
Overall ≥ 75 AND Edge ≥ 60 AND Risk ≤ 45.
Most props fail on stability because game
log data is still building.
As your game log database grows over the
season, PLAY count will grow organically.
Never lower the thresholds to get more PLAYs.
The selectivity is the edge.

## Data Integrity Gates
These gates protect you from acting on
signals that have no real data behind them.

Prior-only props (0 game logs):
- Always tagged NO-PLAY
- P(Over) never shown as colored number
- Never recommended by optimizer
- p99 ceiling not computed

Props with fewer than 5 game logs:
- POverBadge replaced with grey dash
- Hit rate windows hidden
- Optimizer excludes them
- Variance panel shows amber warning

Props with fewer than 30 calibration records:
- Maximum tag is WATCH not PLAY
- LOW SAMPLE badge on True Edge
- PLAY requires calibration validation

Market support with single book:
- marketSupportScore stays neutral (50)
- One book cannot drive action tag
- Minimum 2 books for market signal

Streak badges:
- Minimum 3 consecutive games required
- 2-game streak is noise not signal

These gates open automatically as data
accumulates. Do not try to shortcut them.
They are protecting you from false signals.
