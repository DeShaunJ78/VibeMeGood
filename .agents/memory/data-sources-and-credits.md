---
name: Data source mapping & Odds API credit guards
description: Which provider feeds which data (do NOT collapse onto one source), and how Odds API spend is guarded.
---

# Data source mapping (intentional — do NOT re-wire)

Each provider feeds a specific slice. A user explicitly flagged concern about
collapsing everything onto FantasyPros — keep them separate:

- **PrizePicks API** (`prizepicks`) → `pp_lines`, the actual prop lines, ALL sports.
- **The Odds API** (`the-odds-api`) → sportsbook lines → market-gap signal. Only
  sports in `SPORT_KEYS` (NBA/MLB/NHL/NFL/WNBA) AND only stat markets in
  `STAT_MARKETS` (basketball + baseball). NHL/NFL have no markets → zero calls.
- **FantasyPros scraper** (`fantasypros`, `fpProjectionsJob`) → projections for
  NBA (game logs) + NHL only. NBA projections coming from here is expected.
- **Internal compute** (`nba-stats`) → `our_projections` (normalCDF P(Over)) for
  everything else.

**Why:** live PrizePicks API has NBA league active but 0 projections; NBA props
in this app are reconstructed from game logs + FantasyPros + Odds API, not live PP.

# Odds API cost (the only metered external source worth guarding)

- Cost ≈ markets × regions per batched call; one batched call per sport.
- Usage is tiny in practice (well under 1k credits/month on a 100k plan).
- Guards in `external-odds.ts`: normal path 20-min cooldown; FORCED (pre-lock)
  path has a 5-min `FORCE_FLOOR_MS` + an in-flight mutex so `/sync/pre-lock`
  can't be spammed into draining credits. A skipped sync still recalcs scores
  from existing data (no API spend).
- **How to apply:** to tighten spend, widen the cooldown — never drop sports or
  markets (that hurts signal integrity for no real credit benefit).

# Slate sport grouping

`SPORT_GROUP` in `slate.ts` is the single source of truth for variant→canonical
rollup. Both `/slate` (filtering, via `variantsForSport`) and `/slate-sports`
(counts) derive from it, so counts always match the rows `/slate` returns. If you
add a league variant, add it here only.
