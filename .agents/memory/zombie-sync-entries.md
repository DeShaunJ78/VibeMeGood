---
name: Zombie sync entries
description: Server crashes leave data_pull_logs and sync_runs stuck in "running" permanently — how to clean them up.
---

## Rule
Always call `cleanupStaleRuns()` as a module-level IIFE in `sync.ts` so the first data-health poll after any server restart never shows phantom spinning indicators in the UI.

**Why:** `runSync()` writes a "running" row to `data_pull_logs` and `sync_runs` at job start, then updates to "success" or "error" at completion. A crash or SIGKILL between those two writes leaves the row permanently in "running". The Settings UI reads these rows to show status dots — stuck rows show an infinite amber spinner forever.

**How to apply:**
- `cleanupStaleRuns()` in `artifacts/api-server/src/routes/sync.ts` does a WHERE `status='running' AND startedAt < now()-10min` UPDATE to `status='error'` on both tables.
- Call with `void cleanupStaleRuns()` at module scope (not inside a route handler).
- The cutoff is 10 minutes — generous enough to not kill legitimately long-running syncs.
- First boot after adding this fix cleared 10 data_pull_logs + 15 sync_runs zombie rows.
