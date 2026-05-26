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
