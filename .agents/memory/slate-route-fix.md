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

# Watch state must be applied to EVERY Slate Board row source

**Rule:** On the Slate Board, derive watch state (`isWatched` + `watchlistId`) from the slate rows (the API's source of truth) into a `playerId:statType` map, and apply it to ALL row sources — especially the market-intel-only rows that would otherwise hardcode `isWatched:false / watchlistId:null`. Never trust a single row source to carry watch state through the merge + dedup.

**Why:** The watchlist-remove bug regressed because the board dedups to one row per `playerId:statType` (in the "all" tier view) keyed by a market-data tier score. A watched slate row could be collapsed onto an unwatched MI-only row, so the displayed toggle saw `watchlistId:null` and fell through to ADD on every click — the player could never be un-watched. The server, OpenAPI spec, and generated client were all correct; `customFetch` returns raw JSON with no field stripping, so stale generated TYPES never drop fields at runtime — the regression was purely the frontend merge/dedup losing watch metadata.

**How to apply:** Build the `watchStateByKey` map from `slate` before constructing `miOnlyRows`; look up each MI row's key for `isWatched`/`watchlistId`. Because both sources then carry identical correct watch state per key, whichever row the dedup picks is correct. (Aside: stale generated client types are a build-time concern only — re-run codegen after spec edits, but it is not a runtime data-drop mechanism here.)
