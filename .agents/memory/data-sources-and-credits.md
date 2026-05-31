---
name: Data source mapping & Odds API credit guards
description: Which provider feeds which data (do NOT collapse onto one source), and how Odds API spend is guarded.
---

# Data source mapping (intentional — do NOT re-wire)

Each provider feeds a specific slice. A user explicitly flagged concern about
collapsing everything onto FantasyPros — keep them separate:

- **PrizePicks API** (`prizepicks`) → `pp_lines`, the actual prop lines, ALL sports.
- **The Odds API** (`the-odds-api`) → sportsbook lines → market-gap signal. Only
  sports in `SPORT_KEYS` AND only stat markets in the sport-nested
  `SPORT_STAT_MARKETS` (see "Odds API player-props endpoint" below).
- **FantasyPros scraper** (`fantasypros`, `fpProjectionsJob`) → projections for
  NBA (game logs) + NHL only. NBA projections coming from here is expected.
- **Internal compute** (`nba-stats`) → `our_projections` (normalCDF P(Over)) for
  everything else.

**Why:** live PrizePicks API has NBA league active but 0 projections; NBA props
in this app are reconstructed from game logs + FantasyPros + Odds API, not live PP.

# Odds API player-props endpoint (the live root cause, May 2026)

- Player props are NOT on the FEATURED `/v4/sports/{key}/odds` endpoint anymore —
  it returns **422 INVALID_MARKET**. They live ONLY on the per-EVENT endpoint
  `/v4/sports/{key}/events/{id}/odds`. The events-LIST call
  (`/v4/sports/{key}/events`) is **FREE** (no quota cost); only the per-event
  odds calls are metered.
- Market keys are **sport-specific**: MLB uses `batter_*`/`pitcher_*` (NOT
  `player_*`); basketball (NBA/WNBA) and NHL use `player_*`. A single unsupported
  market key 422s the WHOLE event request, so `SPORT_STAT_MARKETS` must contain
  only verified keys per sport.
- **Why:** old code used the featured endpoint + a flat `player_*` map → captured
  0 rows silently (run still logged "success" with 0 processed). Watch for that
  failure shape — 0 rows is not proof of "no games".

# Odds API credit guards (user is highly credit-sensitive)

- Target ≈ 20–30k credits/mo. Strategy: pull each game ~hourly, but ONLY when
  within ~6h of lock. `external-odds.ts`: `ODDS_WINDOW_MS=6h` filters the free
  events list (`commenceTimeFrom=now`, `commenceTimeTo=now+6h`); games further
  out cost nothing. Hourly cron (`0 * * * *`).
- Cadence gate uses `MIN_INTERVAL_MS` (50 min) compared against the last success
  **`startedAt`** — NOT `finishedAt`. finishedAt drifts with run duration and a
  >Δmin run would make the next hourly tick fall inside the window and skip,
  degrading to every 2h. Gate on startedAt so :00→:00 is always a clean 60min.
  Keep MIN_INTERVAL below the cron interval (50<60).
- FORCED (pre-lock) path: 5-min `FORCE_FLOOR_MS` + in-flight mutex. The pre-lock
  cron force MUST go through `logPull` so it records a success row — the gate
  reads `dataPullLogs`, so an unlogged force lets repeated triggers double-spend.
- A skipped sync still recalcs scores from existing data (no API spend).
- **How to apply:** to tighten spend, narrow `ODDS_WINDOW_MS` or widen
  `MIN_INTERVAL_MS` — never drop sports or markets (hurts signal integrity).

# Slate sport grouping

`SPORT_GROUP` in `slate.ts` is the single source of truth for variant→canonical
rollup. Both `/slate` (filtering, via `variantsForSport`) and `/slate-sports`
(counts) derive from it, so counts always match the rows `/slate` returns. If you
add a league variant, add it here only.
