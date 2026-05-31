---
name: Atomic entry + picks creation
description: How entries and their legs must be persisted together, and why single-call atomic create exists.
---

- `POST /api/entries` (operationId `createEntry`) accepts an **optional inline `picks` array** (`EntryPickInput[]`) and inserts the entry row + all `entry_picks` in a **single DB transaction**. A bad/failed leg rolls back the whole entry — no orphan/ungradeable entries.
- The frontend Entry Builder logs entries via this single atomic call (both `doSave` and the portfolio optimizer's `logPortfolioEntry`). Do NOT go back to creating the entry first and then POSTing legs one-by-one to `/entries/:id/picks` — that path leaves `pickCount:N` entries with zero legs on partial failure.

**Why:** A prior version created the entry, then looped `addEntryPick` per leg. Any leg failure (or simply forgetting the loop) produced entries that were un-gradeable in the Journal — the user's "nothing logs end to end" complaint.

**How to apply:** When logging an entry from the client, always pass `picks` inline in the `createEntry` payload. `entry_picks` has NO FK cascade on `entryId`, so deleting an entry to "undo" a partial insert would orphan picks — rely on the server transaction instead.

- Drizzle `numeric` columns require **string** values on insert at the type level (e.g. `lineValue: String(p.lineValue)`), even though the runtime accepts JSON numbers. The standalone `/entries/:id/picks` route only compiled because it spreads untyped `req.body`.
