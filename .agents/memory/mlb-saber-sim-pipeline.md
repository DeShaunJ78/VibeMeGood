---
name: MLB Saber Sim factor data pipeline
description: Three MLB projection factors are wired in compute.ts but require specific data pipeline work before they fire.
---

## The Rule
The three MLB Saber Sim factors (`mlbPlatoonFactor`, `strikeoutMatchupFactor`, `pitcherFormFactor`) all return null until their prerequisite data is populated. The factor infrastructure and schema are in place — only the data pipeline is missing.

**Why:** Factor functions follow the null-return-on-missing-data contract. No silent fallback to 1.0.

## How to Apply
Before assuming these factors are broken, check whether their data prerequisites exist:

| Factor | Prerequisite |
|---|---|
| `mlbPlatoonFactor` | `player_game_logs.pitcher_hand` populated during game-log sync (tasks #189, #191) |
| `strikeoutMatchupFactor` | Pitcher game logs in `player_game_logs` with `statType: "Strikeouts"` + pitcher as player with `position: "SP"` (task #190) |
| `pitcherFormFactor` | Same pitcher logs + "Earned Runs Allowed", "Innings Pitched", "Walks", "Home Runs Allowed" stat types (task #190) |
| All three | `games.metadata.homeStartingPitcher` / `awayStartingPitcher` populated by schedule sync (task #191) |

## Schema additions (already done)
- `player_game_logs.pitcher_hand varchar(1)` — nullable, set by game-log sync
- `pitcher_profiles` table — seeded with ~60 MLB starters; keyed by `playerName + sport`

## Stat-type naming contract
All pitcher stat keys in compute.ts are stored as `.toLowerCase()` of what historical-stats.ts writes:
| historical-stats.ts writes | compute.ts key |
|---|---|
| `"Pitcher Strikeouts"` | `"pitcher strikeouts"` |
| `"Pitching Outs"` | `"pitching outs"` (÷3 = IP) |
| `"Walks Allowed"` | `"walks allowed"` |
| `"Earned Runs Allowed"` | `"earned runs allowed"` |
| `"Home Runs Allowed"` | `"home runs allowed"` |
| `"Hitter Strikeouts"` | exact match (batter K%) |

## pitcherHand population
Two paths — both needed:
1. **Sync-time**: `resolveGamePitcherHand(gamePk, batterIsHome, lookup, cache)` fetches MLB Stats API `/game/{gamePk}/boxscore`, reads `teams[side].pitchers[0]`, resolves name→hand from pitcher_profiles. Called during MLB hitting backfill; cache prevents duplicate boxscore calls per run.
2. **Historical backfill**: `POST /api/sync/backfill-mlb-pitcher-hand` triggers `backfillMlbPitcherHand()` — DB-only SQL using pitcher game logs × pitcher_profiles × player.team_id to update batter logs where pitcher_hand IS NULL.

## Key files
- `artifacts/api-server/src/lib/projection/factors.ts` — `mlbPlatoonFactor()`, `strikeoutMatchupFactor()`, `pitcherFormFactor()`
- `artifacts/api-server/src/lib/projection/compute.ts` — MLB pre-computation block + per-line wiring
- `artifacts/api-server/src/lib/sync/historical-stats.ts` — `upsertLog` pitcherHand extra, `resolveGamePitcherHand`, `backfillMlbPitcherHand`
- `artifacts/api-server/src/routes/sync.ts` — `POST /api/sync/backfill-mlb-pitcher-hand`
- `lib/db/src/schema/pitcher-profiles.ts` — pitcher hand table
- `scripts/src/seed.ts` — pitcher profiles seed data (~60 starters)
