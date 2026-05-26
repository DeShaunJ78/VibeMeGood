# VibeMeGood Key Metrics Explained

## P(Over)
Bayesian probability estimate that the player goes over the PrizePicks line.
- Computed from: our projection vs the line, historical distribution, opponent matchup
- Displayed as: percentage (e.g., 62.4%)
- Above 60%: strong signal. 55–60%: moderate. Below 55%: thin or no edge.

## Edge Score
Composite score combining: model edge (projection vs line gap), market edge (vs external sportsbook lines), and matchup data.
Tags: PLAY (strong), WATCH (marginal), PASS (no edge), GOBLIN (favorable line type)

## Action Tags
- **GOBLIN**: Line set favorably low — easier to go over
- **PLAY**: Model edge ≥ threshold, recommend consideration
- **WATCH**: Edge exists but below confidence threshold
- **PASS**: No significant edge detected
- **SKIP**: Gated due to injury, data freshness, or other flag

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
