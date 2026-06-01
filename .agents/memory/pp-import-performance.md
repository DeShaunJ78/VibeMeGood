---
name: PP import performance
description: Rules that keep PrizePicks imports/syncs fast, plus a caveat about perf-testing against the live dev DB.
---

# PrizePicks import performance

A full PP feed is thousands of projections. Every code path that writes lines/scores
must do **bulk reads + batched writes**, never per-row DB round-trips.

**Rule:** preload lookup tables into in-memory Maps once, then batch inserts/updates
(chunk large inserts to stay under Postgres' parameter cap). Validate required
NOT-NULL fields up front and drop bad rows before batching — a batched insert has no
per-row fault tolerance, so one invalid row aborts the whole batch.

**Why:** the import once did ~6 sequential queries *per projection*, so a real feed
ran 6+ minutes. A hidden N+1 in the score recompute (batched reads but per-row
writes) alone kept it at ~35s. Batching everything took it to ~1–2s.

**Also:** the Express body limit must stay large or the paste import 413s — PP
payloads are multi-MB.

## Caveat: don't perf-test imports against the live dev DB with real sport names
The PP processing step deactivates stale active lines whose sport appears in the
incoming payload. Importing synthetic data tagged with a real sport (e.g. "NBA")
therefore deactivates the user's **real** lines in that sport.
**How to apply:** tag load-test data with a throwaway sport, or accept that a real
import self-heals the active set afterward.
