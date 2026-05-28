# VibeMeGood Key Metrics Explained

## P(Over)
Bayesian probability estimate that the player goes over the PrizePicks line.
- Computed from: our projection vs the line, historical distribution, opponent matchup
- Displayed as: percentage (e.g., 62.4%)
- Above 60%: strong signal. 55–60%: moderate. Below 55%: thin or no edge.

## 4-Gate Scoring System
Every prop is scored across 4 gates:

Gate 1 — Edge Score (40% weight)
Combines your model's P(Over) with market
gap vs external books.
Above 60 = meaningful edge.
Below 20 = no edge worth considering.

Gate 2 — Stability Score (30% weight)
Based on data quality score and confidence
label from projection engine.
High confidence (+20 bonus): 20+ games used,
strong model fit.
Medium confidence (+10 bonus): 8-20 games.
Low: fewer than 8 games.

Gate 3 — Market Support Score (20% weight)
How much external sharp books agree with
the PrizePicks line placement.
Above 50 = books confirm the edge.
Below 50 = books disagree.

Gate 4 — Risk Score (10% weight, inverted)
Combines GTD injury flag and volatility
(standard deviation of player outcomes).
Lower is better.
Above 45 = high risk, penalizes overall score.

Overall Score =
(Edge × 0.40) + (Stability × 0.30) +
(Market × 0.20) + ((100-Risk) × 0.10)

## Action Tags
- PLAY: Overall ≥ 75 AND Edge ≥ 60 AND
  Risk ≤ 45. All three gates pass.
  Only ~50 props qualify on a full slate.
  That is correct — conservative is right.
- WATCH: Overall ≥ 55 AND Edge ≥ 40.
  Worth monitoring. Not strong enough alone.
- PASS: Overall < 55 or Edge < 20.
  No meaningful edge. Skip it.
- NO-PLAY: Hard gate. Player is OUT,
  GTD, or data quality too low to project.
  Never include in an entry.

## Reading the Reason Summary
Every prop shows: E{score} S{score} M{score} R{score}
Example: E72 S85 M60 R24
Edge 72, Stability 85, Market 60, Risk 24.
All gates passing = PLAY candidate.

## Confidence Badges
LOW badge (amber): fewer than 5 game logs.
Projection is based on prior data only.
Treat with extra caution.
MED label: 5-20 game logs. Growing sample.
No badge: 20+ games. Full confidence.

## LOW SAMPLE Badge
Appears on True Edge when fewer than 30
calibration records exist for this
sport and stat type.
Means: edge score calculated but not yet
validated against real outcomes.
Disappears as you log and settle entries.

## Stale Odds Warning
When external odds data is over 4 hours old:
True Edge column hides completely.
Amber banner appears: sync before acting.
Click Sync Odds button to refresh.

## p99 Ceiling
Each pick in Entry Builder shows:
"ceiling 99th: X.X"
This is mean + 2.33 standard deviations.
The monster game scenario — 1% chance of
this outcome or better.
Use for GPP/upside entries. Ignore for
conservative picks.

## Convergence Signal
Only shows when 5+ game logs exist.
Green: model projection and historical
hit rate point same direction.
Amber warning: they disagree by 8%+.
Disagreement = investigate before playing.

## Line Types (PrizePicks)
- **Goblin**: Lower line (easier over target). Better P(Over) but lower payout.
- **Standard**: Regular line
- **Demon**: Higher line (harder over target). Harder to hit but higher payout.

## CLV (Closing Line Value)
How much your entry line moved against you by game time.
- Positive CLV: line moved your direction after you locked — you "beat" the market
- Negative CLV: line moved against you — market disagreed with your projection
- Avg CLV tracked in Review Dashboard as a process quality signal

## Avg Edge
Average model edge across active props. Tracked as KPI on Command Center.
Edge = (Our P(Over) − Implied P from line) × 100

## Data Health Indicators
- Last sync timestamp per provider
- Records processed count
- Error status with message if sync failed
- Mode indicator: LIVE (real API data) vs SEED (demo data)
