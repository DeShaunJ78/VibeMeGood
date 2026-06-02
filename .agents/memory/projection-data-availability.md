---
name: Projection signal data availability
description: Which projection-input columns/tables are actually populated vs empty — schema presence != data presence.
---

The schema has many adjustment columns/tables that are **defined but NOT populated**.
Always check row-level population before building a factor that reads them, or you
ship a no-op that silently does nothing.

**As audited (verify again — data may accrue over time):**
- `games.spread` / `games.total`: **empty** (0 of recent games). `game_environment` table: **0 rows**. → implied team total has no source; the games sync does not fetch spreads/totals, and the odds sync pulls only player-prop markets (adding game markets costs extra Odds API credits).
- `player_game_logs.minutes`: **all NULL**. `home_away`: **all NULL**. `opponent_team_id`: partially populated (~3%). → projected-minutes, minutes-blowout haircut, and home/away *splits* have no data.
- Box-score stat rows (`FieldGoalsAttempted`/`FreeThrowsAttempted`/`OffensiveRebounds`/`Minutes`) are **absent** from `player_game_logs` (only `Turnovers` exists among them). → live pace-from-logs cannot compute; `team_pace_ratings` are 100% **seed constants** (`games_computed=0`), NBA-only. Pace is a static preseason constant, not a live signal.
- `our_projections` has `paceFactor`/`defenseFactor`/`restFactor` columns — **never written** by computeProjection.
- Weather: `games.metadata.weather` referenced by the UI but **0 games** have it.

**Has real data (safe to wire):**
- `nfl_advanced_metrics`: wopr/target_share ~9k rows, air_yards ~11k, racr ~9k. NFL game logs have Receiving Yards/Receptions (~10k each). NFL receiving-prop signals are real.
- `fatigue_data`: ~3.9k rows; `days_rest`/`isBackToBack`/`isThreeInFour` derive from `game_date` (populated). The rest/B2B portion is real; its minutes-based portion is dead (minutes NULL).
- `players.position`: NFL 100%, NBA/WNBA/MLB partial. DvP (team-defense-vs-position from game logs + opponent_team_id) is feasible mainly for NFL.

**Backtest reality:** essentially no graded history — 1 entry, 4 entry_picks (all 'hit'), `probability_calibration` 0 rows. A meaningful backtest must *replay* historical lines against actual game-log outcomes (ground truth), not read entry results. `pp_line_history` (~1.37M rows) holds line snapshots that could seed such a replay.

**Why:** a prior plan called these factors "easy because the data exists" based on schema columns; the columns exist but are empty, so naive wiring produces silent no-ops.
**How to apply:** before adding any projection factor, run a population/coverage query (count FILTER WHERE col IS NOT NULL) and only wire factors with real coverage; surface the rest as blocked-on-ingestion rather than building dead code.
