---
name: Settings data-health UI freshness signals
description: Which signal each Settings → Data Sync row trusts for green/amber status
---

The Settings "Data Sync" card colors each row from live `/api/dashboard/data-health`, not static styles.

- **PrizePicks Lines row** keys off `boardFreshnessAt` / `boardAgeHours` (= max `lastSyncedAt` over active `pp_lines`), NOT the `prizepicks` `data_pull_logs` status. Green when `boardAgeHours <= 6`. This is what turns the row green immediately after a browser import (imported lines get `lastSyncedAt = now`). Line count text uses the prizepicks log `recordsLastSync` (= last import's processed count, not a live active-line count — equal right after import, can drift later).
- **Generic sync rows** map endpoint → provider via `JOB_PROVIDER` and read provider-level aggregation (computed server-side over the last 500 logs — good coverage for infrequent jobs).

**Why:** `data-health` is in the OpenAPI spec (`DataHealth`), so adding a per-job (jobName) health map would need spec + Orval codegen. Provider-level aggregation already covers every row; the only shared-provider pair among rows is Game Scores + Sync Games (both `espn`), which both legitimately reflect ESPN data freshness. Not worth a backend payload to disambiguate.

**How to apply:** If a future "row should be green/red but isn't" bug appears: PP row → check `boardFreshnessAt`; other rows → check the mapped provider's latest log in the 500-log window. Don't switch generic rows to `lastPullLogs` (only 30 entries → infrequent jobs fall off and go falsely grey).
