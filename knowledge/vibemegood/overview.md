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
- Runs a Personal Shark (quick-query sharp assistant) for fast edge questions

## What It Is NOT
- Not a sportsbook. No real-money wagering happens inside the app.
- Not a DFS lineup optimizer (that's DraftDuel).
- Not PropEdge (that's a different tool for sportsbook prop betting).
- Not a general-purpose sports betting tool — PrizePicks pick'em only.

## Core Screens

### Analytics
1. **Command Center** — KPI overview (active props, watched, pending entries, avg edge), top PLAY props, recent injuries, today's games with O/U
2. **Slate Board** — All active props with edge scoring, watchlist toggles, sport/action/edge filters, preset quick-filters (Safe/Aggressive/Longshot), Team picks tab, Culture picks tab, PropDetailSheet, line optimizer
3. **Injuries & News** — Status tracking with severity colors + Intel Feed (hot streaks, line moves, model plays/fades, lineup confirmations)
4. **Entry Builder** — Picks cart with Power/Flex toggle, real payout calculator, Kelly fraction, stake input, LOG ENTRY
5. **Journal** — Entry history with P&L, WIN/LOSS/PARTIAL/PENDING results, early exit badge, AI Entry Analysis (SSE streaming)
6. **Review Dashboard** — Bankroll curve, Total P&L, Entry Hit Rate, Pick Hit Rate, Avg CLV KPIs
7. **AI Analyst** — Multi-turn Claude-powered chat with full live slate context (persistent conversation history)
8. **Lineup Factory** — Generates optimal Power or Flex entries from the current slate; lock/exclude props; returns combined P(hits) and EV

### Intelligence Pages
9.  **Streak Tracker** — Multi-game over/under streaks per player/stat. Filter by sport and minimum streak length (1+/2+/3+/5+). Streaks ≥5 = strong pattern.
10. **CLV Tracker** — Closing Line Value history. Positive CLV = you beat the closing number (process quality signal independent of outcomes).
11. **Matchup Analysis** — Head-to-head over rate vs specific opponents. 70%+ over rate vs an opponent = matchup edge.
12. **Model Calibration** — Brier Score 0.2104 (lower = better; 0.25 = random coin flip). 36,681 samples. Measures how well P(Over)% matches real hit rates.
13. **Model Audit** — 74.9% hit rate on high-confidence predictions. Breakdown by sport, stat type, and probability bucket.
14. **Stability Radar** — Visual consistency per player/stat. IQR and variance vs model expectation. High variance + high line = risk.
15. **Fatigue Tracker** — Back-to-back games, travel miles, timezone shifts, rest days. High fatigue hurts counting stats (NBA especially).
16. **Usage Signals** — Minutes/usage trends vs season average. +15% spike = positive signal. -15% drop = potential fade flag.
17. **Shark Chat** — Quick-query sharp analytics assistant (single-session, no history). Fast edge questions, build correlated entries, check break-even math.

### System
18. **Settings & Data Health** — Sync controls per provider, Sync All, live sync logs
19. **System Status** — Full diagnostic health check with numbered data pipeline steps

## Slate Board Tabs
- **Player** — Standard player props (default view)
- **Team** — Team total props (team-level over/under; pickCategory='team')
- **Culture** — Entertainment/pop culture picks (no historical game log data — model-free; pickCategory='culture')

## The Variance Intelligence Engine
An optional contextual overlay (master toggle in Settings) that adds:
- Fatigue & Rest Modeling (back-to-backs, travel miles, timezone shifts)
- Game Environment scoring (blowout risk, spread, pace)
- Role & Usage Trends (minutes spike or drop vs season average)
- Matchup Depth (historical over rate vs specific opponent)
- EV modifier (capped ±15%) applied to prop scores

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
