---
name: Drizzle inArray overflow — full fix map
description: inArray() with large ID arrays overflows the JS call stack in production; every query site that can receive 14k+ IDs must be chunked.
---

## The rule
`inArray(col, ids)` where `ids` can exceed ~200 elements **must** be wrapped in `queryInChunks()`. Drizzle builds a recursive SQL expression tree; the recursion depth overflows the production JS call stack well before 1 000 items. Dev doesn't hit it because dev DB has ≤50 active lines.

**Why:** A 14 770-line PP browser import means `playerIds` ≈ 5 000 unique players and `lineIds` = 14 770. Every query that filters on those arrays breaks without chunking.

## The helper
`artifacts/api-server/src/lib/db-utils.ts` exports `queryInChunks(ids, fn, chunkSize=500)`.
- Uses `concat` not spread (`push(...batch)` is the other way to overflow the stack on large arrays).
- compute.ts and variance/index.ts have their own identical local copies (IN_CHUNK=200); do not remove them.

## Fixed call sites (as of this session)
| File | Array | Why large |
|---|---|---|
| `lib/sync/external-odds.ts` | `activeIds` (ppLineIds) | All active lines |
| `lib/sync/streaks.ts` | `playerIds` | All active-line players |
| `lib/projection/compute.ts` (multiple) | `playerIds`, `pitcherIds` | Active-line players + ALL MLB pitchers in DB |
| `lib/variance/index.ts` (multiple) | `playerIds` | Active-line players |
| `routes/slate.ts` | `lineIds`, `playerIds` | Full slate |
| `routes/dashboard.ts` | `lineIds`, `playerIds` | Full slate |
| `routes/lineup-factory.ts` | `ppLineIds`, `playerIds` | All active player lines |

## How to apply
Any time you add a new `inArray(col, someIds)` where `someIds` is derived from active PP lines, all players, or any table that scales with the full dataset: wrap it in `queryInChunks`. Arrays bounded by today's games (gameIds ≤ ~200) or team counts (≤ 120) are safe without chunking.

**Never accumulate chunk results with spread:** `results.push(...batch)` also overflows on large arrays. Always use `concat` or a `for...of` loop.
