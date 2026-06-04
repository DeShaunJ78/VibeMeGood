---
name: Roster auto-population
description: backfillHistoricalStats was silently dropping 95%+ of boxscore data because player name matching only worked for players already in the players table. Fix pre-fetches all league rosters and upserts unknown players before the boxscore/game-log pass.
---

## The problem
`backfillNBA/MLB/NHL` match ESPN/NHL/MLB player names against the `players` table.
Any player not already in that table gets silently skipped — no error, just 0 logs written.
With only PP-imported players (12 NBA, 4 MLB), 95%+ of every boxscore downloaded was discarded.
Result: calibration ran on 36K examples across 16 players instead of 3M+ examples across 1500+ players.

## The fix (in `historical-stats.ts`)
Each sport function now has a roster pre-population block that runs BEFORE the game-log/boxscore pass:

- **NBA**: Fetches `GET /api/v2/sports/basketball/nba/teams/{teamId}/roster` for all 30 teams (batched 10 at a time). Parses position groups (`athletes[].items[]`). Upserts all new players. Rebuilds `nameToId` map before boxscore pass.
- **MLB**: Already fetches `GET /sports/1/players?season={N}&limit=2500`. Now upserts all players from that response instead of only matching existing DB players. Reloads DB before matching.
- **NHL**: Roster fetch was already there for ID mapping. Now also collects `{first, last, teamAbbr, position}` and upserts new players. Rebuilds `dbNormMap` before game-log fetch.

All three use `onConflictDoNothing()` for safety. Early-exit guards (`if (nbaPlayers.length === 0) return 0`) were removed — the sync works even with zero existing players.

## Expected data scale after first full run
- NBA: ~450 players × 3 seasons × ~65 games × 11 stats ≈ **1M+ rows**
- MLB: ~750 players × 3 seasons × ~130 games × 12 stats ≈ **3.5M rows**
- NHL: ~700 players × 3 seasons × ~60 games × 8 stats ≈ **1M+ rows**

## Post-run calibration rebuild
After the first full Backfill History run, MUST do:
1. `TRUNCATE probability_calibration` (stale buckets from sparse data will be wrong)
2. POST `/api/sync/calibration` or run `pnpm calibrate` to rebuild from full dataset

**Why:** The old calibration was built from 16 players. The new one will see 1500+ players — hit rates per bucket will shift significantly. Serving stale calibration on top of the new projections degrades accuracy.

## CI improvement expected
- Before: avg ~221 samples/bucket → CI ±5–15%
- After: avg 5,000–15,000 samples/bucket → CI ±0.5–2%
