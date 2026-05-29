# VibeMeGood — What It Is

VibeMeGood is a private full-stack analytics workstation for evaluating PrizePicks pick'em props.

## What It Is
A desktop-first analytics tool that:
- Pulls live PrizePicks lines and syncs them to a local database
- Builds Bayesian probability estimates (P(Over)) for each prop
- Scores each line against external market lines for edge detection
- Tracks variance signals (fatigue, blowout risk, usage trends, matchup depth)
- Manages an entry log (Journal) with P&L tracking
- Runs an AI Analyst for multi-turn analysis conversations

## What It Is NOT
- Not a sportsbook. No real-money wagering happens inside the app.
- Not a DFS lineup optimizer (that's DraftDuel).
- Not PropEdge (that's a different tool for sportsbook prop betting).
- Not a general-purpose sports betting tool — PrizePicks pick'em only.

## The 8 Core Screens
1. **Command Center** — KPI overview, top plays, injuries, today's games
2. **Slate Board** — All active props with edge scoring, watchlist, optimizer
3. **Injuries & News** — Status tracking with severity colors
4. **Entry Builder** — Cart with Pick'em Math panel (break-even, EV, payout shift)
5. **Journal** — Logged entries with P&L, WIN/LOSS/PARTIAL results
6. **Review Dashboard** — Bankroll curve, hit rates, CLV tracking
7. **AI Analyst** — Multi-turn Claude-powered chat with live data context
8. **Settings & Data Health** — Sync controls, Variance Intelligence config

## The Variance Intelligence Engine
An optional contextual overlay that adds:
- Fatigue & Rest Modeling (back-to-backs, travel miles, timezone shifts)
- Game Environment scoring (blowout risk, spread, pace)
- Role & Usage Trends (minutes spike or drop vs season average)
- Matchup Depth (historical over rate vs specific opponent)
- EV modifier (capped ±15%) applied to prop scores

Master toggle is OFF by default. When OFF, the app behaves identically to before.

## Data Infrastructure

VibeMeGood is backed by 1,192,538 historical game log records across four sports:

NBA: 77,248 records
- 3 seasons (2023-24 through 2025-26)
- 11 stat types per game entry
- Source: ESPN scoreboard API

MLB: approximately 900,000 records
- 3 seasons (2023, 2024, 2025)
- 8 batter + 4 pitcher stat types
- Source: statsapi.mlb.com

NHL: 139,159 records
- 3 seasons (2023-24 through 2025-26)
- 5 stat types per game entry
- Source: api-web.nhle.com

NFL: 72,932 records
- 2 seasons (2023, 2024)
- 7 stat types per entry
- Source: nflverse GitHub CSVs
- 2025 season auto-populates when nflverse publishes it

## Nightly Data Pipeline

2:00 AM — Game log sync (NBA/MLB/NHL)
3:00 AM — Data retention cleanup
4:00 AM — Matchup history rebuild
6:00 AM — Projections computed
6:30 AM — Variance scores computed
6:35 AM — Fatigue data synced
7:00 AM — FantasyPros scraper runs
Every 10 min — PP lines synced
Every 30 min — Game schedule updated
Every minute — Pre-lock check

## Ensemble Blending

When calibration records reach 100+ the projection engine blends:
- 30% blend at 30-99 records
- 70% blend at 100+ records

Blend uses your actual hit rates per stat type weighted against the model base projection.

## Game Schedule Linking

PP lines are linked to ESPN game schedule entries via gameId. Enables:
- Pre-lock scraper (fires 2h before tip)
- Calibration job matching lines to outcomes
- Accurate game time display

Sport normalization maps PP variants:
MLBLIVE → MLB
NBA1Q → NBA
NHL1P → NHL
WNBA1H → WNBA
