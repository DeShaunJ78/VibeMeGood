---
name: Slate list route fix
description: ourProjectionsTable vs projectionsTable — which to use in slate routes
---

# Slate Route — Use ourProjectionsTable

**Rule:** Always join `ourProjectionsTable` (table: `our_projections`) for projection data in slate list and detail routes. Never use `projectionsTable` (table: `projections`).

**Why:** `projectionsTable` has only 18 seeded legacy rows. `ourProjectionsTable` has 2,374+ real computed projections with pOver, projectedValue, stdDev, etc. Using the wrong table caused all 7,454 slate props to show null yourProjection and pOver, and edgeScores were computed without pOver data.

**How to apply:** Any new route that needs player projections must import from `../db` and use `ourProjectionsTable`, not `projectionsTable`.

# Slate List Route — Must Return watchlistId

**Rule:** The slate LIST route must return both `isWatched` AND `watchlistId` per row, keyed by `${playerId}:${statType}`. The detail route already did; the list route only had a `Set` for `isWatched`.

**Why:** The board's WatchToggle removes only when `isWatched && watchlistId != null`. Without `watchlistId` on list rows, every toggle fell through to ADD — players could never be un-watched from the Slate Board.

**How to apply:** Build a `Map<"playerId:statType", id>` from watchlistItems alongside the existing Set; emit `watchlistId`. Multiple ppLines sharing a player/stat (tiers) correctly all get the same watchlistId. Field is part of OpenAPI `SlateRow` — keep it in the contract.
