---
name: Manual hand-entry slips
description: How user-typed PrizePicks slips (no player FK) are stored, graded, and resolved across routes.
---

# Manual hand-entry slips

Users on the LIVE app log slips by hand in the Journal "Log New Entry" modal: each leg is free-typed (player name, stat, line, over/under) with no FK to the players table.

- `entry_picks.playerId` is nullable; `entry_picks.playerName` holds the free-typed name. Manual legs set `playerId: null` + `playerName`.
- All three GET routes that enrich picks (`GET /entries`, `GET /entries/:id`, `GET /entries/:entryId/picks`) must: filter null playerIds before the players join, then resolve display name as `(joined fullName) ?? pick.playerName ?? null`. Miss any one and manual legs render nameless.
- Leg grading enum is **hit | miss | dnp** (plus `pending`) — there is NO `push`. This enum must stay aligned across: InlinePickSchema (create), PickResultSchema (PATCH grade), and the Journal UI dropdowns. Adding a value at create-time that PATCH/UI can't set = ungradeable legs.
- A slip is 2–6 legs. Enforced server-side in `POST /entries` (rejects malformed payloads with 400), not just in the modal.

**Why:** dev DB ≠ prod DB. The user works on the published app and needs to key in slips themselves via UI (back-dating missed nights), then grade legs later so calibration/P&L computes. DB-side edits by the agent don't help them.
**How to apply:** when touching entry-pick create/read/grade paths, preserve nullable-playerId handling, the playerName fallback in every GET, and the hit/miss/dnp-only grading enum.
