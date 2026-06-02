---
name: Sync job completion signal (fire-and-forget + SSE)
description: How sync routes report completion, and why UI must not use fixed-delay refetch
---

Most `/api/sync/*` routes are **fire-and-forget**: the POST responds `{ status: "started" }` immediately (so the proxy doesn't time out on multi-minute jobs), then the job runs asynchronously. A few routes (e.g. `pace`, `sharp`) are synchronous and return their result directly.

**The real completion signal is the `sync_status` SSE event** broadcast on `GET /api/events` via `broadcastSyncStatus(job, "success"|"error", detail)`. Freshness in DB is `data_pull_logs.finishedAt` keyed by `jobName` (written by `runSync` and the handful of routes that log explicitly).

**Why:** Any UI that triggers a sync and then refetches after a fixed `setTimeout` will read stale state, because the job is almost always still running when the timer fires. This produced the recurring "I clicked Fix / imported and the row stays amber" complaints.

**How to apply:**
- UI that triggers a sync must resolve completion off the `sync_status` SSE event (match on `job`), not a delay. Treat HTTP `{ status: "started" }` as "started", not "done"; a non-`started` body means a synchronous route already finished. Keep a generous safety timeout only as a last-resort fallback.
- `jobName` broadcast ≠ the route path or the UI action name. Notable mismatches: injuries→`sync-injuries`, scores→`sync-scores`, nfl-advanced→`nfl-advanced-metrics`. Verify the exact string in `runSync(...)`/`broadcastSyncStatus(...)` calls before matching.
- When adding a new async sync route, **always** call `broadcastSyncStatus` on both success and error, or its button/row will never auto-update.
