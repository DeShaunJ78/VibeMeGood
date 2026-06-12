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

## Key files
- `artifacts/api-server/src/lib/projection/factors.ts` — `mlbPlatoonFactor()`, `strikeoutMatchupFactor()`, `pitcherFormFactor()`
- `artifacts/api-server/src/lib/projection/compute.ts` — MLB pre-computation block + per-line wiring (~line 620–800)
- `lib/db/src/schema/pitcher-profiles.ts` — pitcher hand table
- `scripts/src/seed.ts` — pitcher profiles seed data (~60 starters)
