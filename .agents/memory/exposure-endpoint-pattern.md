---
name: Exposure endpoint pattern
description: How GET /api/entries/exposure aggregates pending-entry game-level stake concentration.
---

`GET /api/entries/exposure` lives in `artifacts/api-server/src/routes/entries.ts` (before the generic `/entries` route).

**Key design:**
- Queries only `result = 'pending'` entries.
- Loads picks for those entries, then collects unique `gameId`s.
- Loads `gamesTable` and `teamsTable` in-memory (not SQL join aliases) — simpler and avoids aliased-table Drizzle complexity.
- Dedupes by `(entryId, gameId)` to avoid double-counting entries with multiple picks in the same game: an entry contributes its full stake to a game only once, not once per pick.
- `concentrationPct` = `(gameStake / totalStake) * 100`; `isHighConcentration` = pct >= 40.
- `maxConcentrationPct` = max across all games; Dashboard uses >= 35 to show the KPI card.

**Frontend:**
- Dashboard (`dashboard.tsx`): `useGetEntriesExposure`, show concentration banner when `maxConcentrationPct >= 35`
- Entry Builder (`entry-builder.tsx`): collapsible "Tonight's Exposure" panel, amber highlight >= 40%

**Why:** One entry = one stake unit per game regardless of pick count. Otherwise a 6-leg entry spanning 3 games with 2 picks each would triple-count.
