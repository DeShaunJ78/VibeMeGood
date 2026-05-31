---
name: Player position data source
description: Where player.position comes from and why many players legitimately have null
---

# Player position is sourced from the PrizePicks live feed

**Rule:** `players.position` is populated almost entirely by the pp-lines sync (`syncPpLines`), which reads `position` from each PrizePicks `new_player` include (`pAttr.position`, e.g. 'IF','OF','P','QB'). The seed sets it for a handful of NBA stars; the NFL historical-stats sync sets it for discovered skill players. No other source fills it.

**Why:** A bug report said "no players have positions on Slates." Root cause was NOT rendering (frontend already shows `row.position ?? "—"`) and NOT the slate route (it returns `player.position`). The pp-lines sync simply never captured the field, so every PP-discovered player (the vast majority, esp. MLB) had null. Capturing `pAttr.position` on insert + backfilling on update fixes it; one pp-lines sync backfills nearly all players present in the live feed.

**How to apply:** Players whose lines are NOT in the current live PrizePicks feed (historical/inactive/seeded-only) will still have null position — that is expected, not a bug, because PP only returns currently-offered projections. To backfill, run `POST /api/sync/pp-lines` (async). Don't try to invent positions for players absent from the live feed.
