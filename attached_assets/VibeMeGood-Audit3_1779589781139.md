# VibeMeGood — Build 3 Full Audit
### Every confirmed bug, gap, and broken wire. Fix in priority order.

---

## WHAT'S ACTUALLY WORKING NOW ✅

Significant progress from builds 1 and 2. These are confirmed solid:

- `lastSyncedAt` on pp_lines — schema added, stamped on every sync, deactivation now date-based (no more inArray failure at scale)
- Market-intel 12-hour filter — only returns today's props
- Alerts: all 3 delete routes exist (`/alerts/:id`, `/alerts/clear-all`, `/alerts/read`)
- Alerts: Clear Read and Clear All buttons wired in dashboard UI
- DB transactions in entries.ts — result resolution is atomic
- Zod validation — CreateEntrySchema and PickResultSchema exist in entries.ts
- Mobile table: `hidden md:table-cell` and `hidden lg:table-cell` applied
- Slate Board pagination — 75 rows at a time with Show More, useMemo filtering
- Optimizer localStorage persistence — results survive navigation, Re-run label
- Variance schemas — fatigue_data, variance_scores, experimental_signals, referee_data all exist
- Variance compute logic — compute-variance.ts and index.ts implemented
- Variance routes — `/api/variance` and `/api/variance/:ppLineId` registered
- All 5 Variance pages — stability, fatigue, environment, usage, lab — routed and accessible
- Lineup Factory — full backend with Zod config schema, diversity algorithm, real routes
- Player photos — player-avatar.tsx component exists, imageUrl in players schema, captured from PP API
- Injuries sync — REAL implementation hitting ESPN API (not a stub anymore)
- AI chat BASE URL — fixed, uses import.meta.env.BASE_URL
- Force Sync — calls 5 real jobs: pp-lines, injuries, external-odds, projections, variance
- Schema index — all new tables exported correctly
- All routes registered in index.ts
- All pages registered in App.tsx

---

## 🔴 CRITICAL — App Cannot Self-Sustain Without These Fixes

---

### Bug 1: CRON IS ALL STUBS — App Only Syncs When You Manually Click Force Sync

**File:** `artifacts/api-server/src/lib/cron.ts`

This is the biggest remaining problem. Every cron job except variance returns 0 and does nothing:

```typescript
// CURRENT — BROKEN: all stubs
cron.schedule("*/15 * * * *", async () => {
  await logPull("prizepicks", "line-snapshot", async () => {
    // Stub: In production, pull from PrizePicks API
    return 0;  // ← DOES NOTHING
  });
});

cron.schedule("*/30 * * * *", async () => {
  await logPull("injury-news", "injury-feed", async () => {
    return 0;  // ← DOES NOTHING
  });
});

cron.schedule("*/20 * * * *", async () => {
  await logPull("external-odds", "external-odds", async () => {
    return 0;  // ← DOES NOTHING
  });
});

cron.schedule("0 6 * * *", async () => {
  await logPull("projections", "daily-projections", async () => {
    return 0;  // ← DOES NOTHING
  });
});
```

The Force Sync button calls real functions. The cron does not. This means:
- Props go stale the moment you stop clicking Force Sync
- Injuries never auto-update (even though the real syncInjuriesImpl exists)
- External odds never refresh automatically
- Projections only run at startup, never again automatically
- The only thing the cron actually does is variance scores at 6:30 AM

**Fix — wire real functions into every cron job:**

```typescript
import { syncPpLines } from "./sync/prizepicks";
import { syncExternalOdds, recalcPropScores } from "./sync/external-odds";
import { computeAllProjections } from "./projection/compute";
import { computeStreaks } from "./sync/streaks";
import { computeAllVarianceScores } from "./variance";
// syncInjuriesImpl is defined in routes/sync.ts — extract it to lib/sync/injuries.ts
// so cron can import it directly (see Bug 2 below)

export function startCronJobs() {
  // PP lines every 10 minutes
  cron.schedule("*/10 * * * *", () =>
    logPull("prizepicks", "pp-lines", syncPpLines)
  );

  // Injuries every 20 minutes
  cron.schedule("*/20 * * * *", () =>
    logPull("injury-news", "injuries", syncInjuriesFromFile)  // see Bug 2
  );

  // External odds every 20 minutes
  cron.schedule("*/20 * * * *", () =>
    logPull("the-odds-api", "external-odds", syncExternalOdds)
  );

  // Projections at 6 AM
  cron.schedule("0 6 * * *", () =>
    logPull("nba-stats", "projections", async () => {
      const n = await computeAllProjections();
      await recalcPropScores();
      await computeStreaks();
      return n;
    })
  );

  // Variance at 6:30 AM (already correct — keep)
  cron.schedule("30 6 * * *", () =>
    logPull("internal", "variance-scores", computeAllVarianceScores)
  );

  // Stale data check every hour (already correct — keep)
  // ...
}
```

---

### Bug 2: syncInjuriesImpl Is Trapped Inside routes/sync.ts — Cron Cannot Import It

**Problem:** The real `syncInjuriesImpl` function is defined inside `routes/sync.ts`. Cron lives in `lib/cron.ts`. Cron cannot import from a routes file without creating a circular dependency. That's why the cron has a stub — the real function wasn't movable.

**Fix:** Extract `syncInjuriesImpl` to a shared lib file:

Create `artifacts/api-server/src/lib/sync/injuries.ts`:

```typescript
import { db } from "@workspace/db";
import { playersTable, injuriesTable, alertsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import { broadcast } from "../sse";

const SPORT_URLS: Record<string, string> = {
  NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
  MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries",
  NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries",
  NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries",
  WNBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/injuries",
};

export async function syncInjuries(): Promise<number> {
  // Copy the full body of syncInjuriesImpl from routes/sync.ts here exactly
  // Then update routes/sync.ts to import and call this function
}
```

Update `routes/sync.ts`:
```typescript
import { syncInjuries } from "../lib/sync/injuries";
// Replace syncInjuriesImpl definition with:
// async function syncInjuriesImpl() { return syncInjuries(); }
```

Update `lib/cron.ts`:
```typescript
import { syncInjuries } from "./sync/injuries";
// Replace the injury cron stub with:
cron.schedule("*/20 * * * *", () => logPull("injury-news", "injuries", syncInjuries));
```

---

### Bug 3: Fatigue Data Table Is Never Populated — All Variance Fatigue Scores Default to 50

**File:** `artifacts/api-server/src/lib/variance/index.ts` lines 24-37

The variance engine reads from `fatigue_data`:
```typescript
const [fatigueRow] = await db.select().from(fatigueDataTable)...
const fatigueResult = fatigueRow && fatigueRow.fatigueScore !== null
  ? computeFatigueScore(...)
  : { score: 50, label: "No schedule data", warnings: [] }; // ← ALWAYS HITS THIS
```

Nothing writes to `fatigue_data`. The table is empty. Every player gets `fatigueScore: 50` (neutral) forever. Back-to-back detection, travel distance, minutes load — none of it works because the data source is empty.

**Fix:** Create `artifacts/api-server/src/lib/sync/fatigue.ts` using the full spec in `VibeMeGood-FatigueTracker.md`. Then:

Add to startup warmup in `index.ts`:
```typescript
import { syncFatigueData } from "./lib/sync/fatigue";

setTimeout(async () => {
  const n = await computeAllProjections();
  await recalcPropScores();
  await computeStreaks();
  await syncFatigueData();   // ← ADD after projections (needs game logs)
  logger.info({ computed: n }, "Startup complete");
}, 2000);
```

Add to cron:
```typescript
import { syncFatigueData } from "./sync/fatigue";
// After projections at 6:30 AM:
cron.schedule("30 6 * * *", () => logPull("internal", "fatigue", syncFatigueData));
```

Add to `/sync/all` jobs array in sync.ts:
```typescript
{ name: "fatigue", provider: "internal", fn: syncFatigueData },
```

---

### Bug 4: Auth Is Still req.query.userId — Any User Can Access Any Data

**File:** `artifacts/api-server/src/routes/entries.ts` lines 69, 134

```typescript
// CURRENT — insecure:
const userId = (req.query.userId as string) ?? "local";
```

Clerk is installed but the middleware is never applied. This means anyone with the API URL can read or write any user's entries, picks, loss limits, and settings by passing a different userId.

**Fix:** Apply Clerk middleware in `app.ts`, then replace req.query.userId in all protected routes:

```typescript
// app.ts — add after cors():
import { clerkMiddleware } from "@clerk/express";
app.use(clerkMiddleware());

// entries.ts — replace every instance of:
const userId = (req.query.userId as string) ?? "local";
// With:
const userId = req.auth?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });
```

Apply the same pattern to: user-settings.ts, clv.ts, review.ts, behavioral-logs endpoints.

---

### Bug 5: DATA_MODE Still Defaults to "mock" — Settings Page Still Shows MOCK MODE

**File:** `artifacts/api-server/src/routes/data-health.ts` line 37

```typescript
const mode = process.env.DATA_MODE ?? "mock";  // ← unchanged from build 1
```

**Immediate fix:** Add `DATA_MODE=live` to Replit Secrets.

**Code fix:** Auto-detect from actual sync history (see VibeMeGood-MockFix.md). The one-liner fix is the env var. Takes 30 seconds.

---

## 🟡 MEDIUM — Broken Features That Affect Usability

---

### Bug 6: Fatigue Tracker Shows Stat Types, Not Player Names

**File:** `artifacts/prizepicks/src/pages/variance/fatigue.tsx` lines 59-75

The Fatigue Tracker fetches from `/api/variance` which returns `variance_scores`. That table has `statType` but no `playerName`. The UI displays `{r.statType}` (e.g., "Points", "Rebounds") instead of the player name.

**Fix in variance route** — join to players table:

```typescript
// In routes/variance.ts GET /variance, add player name to the select:
const scores = await db.select({
  // ...existing fields...
  playerName: playersTable.fullName,
  sport: playersTable.sport,
  teamAbbr: teamsTable.abbreviation,
}).from(varianceScoresTable)
  .leftJoin(playersTable, eq(varianceScoresTable.playerId, playersTable.id))
  .leftJoin(teamsTable, eq(playersTable.teamId, teamsTable.id));
```

**Fix in fatigue page** — use playerName not statType:

```tsx
// Replace: <span className="font-mono text-sm font-bold">{r.statType}</span>
// With:
<div>
  <div className="font-bold text-sm">{r.playerName ?? "Unknown"}</div>
  <div className="text-[10px] font-mono text-muted-foreground">{r.statType} · {r.sport}</div>
</div>
```

Apply same fix to stability.tsx, environment.tsx, and usage.tsx — all show statType instead of player names.

---

### Bug 7: Seed Scripts Are Populating the DB With Fake Players

**Files:** `scripts/src/seed.ts`, `seed-entries.ts`, `seed-game-logs.ts`, `seed-matchup-history.ts`

These scripts insert hardcoded fake data: Jayson Tatum, Nikola Jokic, Stephen Curry, LeBron James, etc. with made-up game logs and entries. If any of these were run against the production database, they explain why the app shows players who aren't on today's real PP slate.

**Check if seed data exists:**
```sql
SELECT full_name, created_at FROM players ORDER BY created_at LIMIT 20;
-- If you see Jayson Tatum, Nikola Jokic etc. from a date in the past, seeds were run
```

**If seed data is present:**
```sql
-- Clear seed data (WARNING: this also removes any real synced data)
-- Only run if you're sure these are seed records, not real PP players
DELETE FROM players WHERE full_name IN (
  'Jayson Tatum', 'Nikola Jokic', 'Stephen Curry', 'LeBron James',
  'Giannis Antetokounmpo', 'Jaylen Brown', 'Kevin Durant', 'Devin Booker',
  'Jamal Murray', 'Jimmy Butler', 'Donovan Mitchell'
) AND NOT EXISTS (
  SELECT 1 FROM pp_lines WHERE pp_lines.player_id = players.id AND pp_lines.is_active = true
);
```

**Prevent future seeding:** Add a guard to seed.ts:
```typescript
if (process.env.NODE_ENV === "production") {
  console.error("Seed scripts must not run in production");
  process.exit(1);
}
```

---

### Bug 8: Startup Variance Computation Not in Warmup

**File:** `artifacts/api-server/src/index.ts`

The startup warmup runs projections, recalcPropScores, and streaks — but not variance. So variance scores are only computed at 6:30 AM cron or when Force Sync is clicked.

```typescript
// Add to startup setTimeout:
import { computeAllVarianceScores } from "./lib/variance";

setTimeout(async () => {
  const n = await computeAllProjections();
  await recalcPropScores();
  await computeStreaks();
  await computeAllVarianceScores();  // ← ADD
  logger.info({ computed: n }, "Startup complete");
}, 2000);
```

---

### Bug 9: Lineup Factory Depends on Variance Data That Doesn't Exist Yet

**File:** `artifacts/api-server/src/routes/lineup-factory.ts`

The lineup factory reads from `variance_scores` to score and filter props. If variance hasn't run (because fatigue_data is empty → variance scores all default to 50 → stability ratings are wrong), lineup factory produces suboptimal results.

**Not a code bug** — this resolves automatically once Bug 3 (fatigue sync) is fixed. Note it so the agent knows to test lineup factory AFTER fixing fatigue.

---

### Bug 10: Environment Board and Usage Signals Have Same Player Name Problem as Fatigue Tracker

**Files:** `artifacts/prizepicks/src/pages/variance/environment.tsx`, `usage.tsx`, `stability.tsx`

All four variance pages fetch from `/api/variance` and display `r.statType` instead of player names. The fix in Bug 6 (joining players table in the variance route) fixes all four pages simultaneously. Just ensure all pages use `r.playerName` after the route fix.

---

## 🟢 INFORMATIONAL — Lower Priority But Worth Noting

---

### Note 1: Lineup Factory Is Well-Built but Untestable Until Data Is Real

The lineup-factory backend has real Zod validation, diversity algorithm, EV calculation, and multiple optimization modes. The frontend has a proper UI with format selector, variance profile, exposure controls. This will work correctly once real projection data and variance scores exist.

---

### Note 2: Player Photos Are Wired But Won't Show Until PP Sync Has Run

The `player-avatar.tsx` component exists. `imageUrl` is captured from `pAttr.image_url` in the PP sync. But photos will only appear for players whose records have been updated by a real PP sync that returned image URLs. If seed data is in the DB, those players won't have imageUrl populated.

---

### Note 3: Experimental Lab, Stability, Environment, Usage Pages Are Display-Only

All four variance pages correctly show empty states when data is absent (not demo data). They just show stat types instead of player names (Bug 6). Once Bug 6 is fixed and variance scores are computed with real fatigue data, all four pages will display correctly.

---

### Note 4: CLV Tracker, Streaks, and Matchup Require User Activity to Populate

These pages are correctly implemented. They show empty states when no data exists. They will populate naturally as the user logs results, marks picks, and builds match history. No bug — by design.

---

## IMPLEMENTATION ORDER

```
TIER 1 — Do These First (Core Functionality)

1. Fix cron.ts — wire real functions into every job (Bug 1)
   This is the root cause of most "nothing is auto-updating" symptoms

2. Extract syncInjuries to lib/sync/injuries.ts (Bug 2)
   Required before cron can import it

3. Create lib/sync/fatigue.ts and wire it (Bug 3)
   Required for Fatigue Tracker and variance quality

4. Add DATA_MODE=live to Replit Secrets (Bug 5)
   30 seconds, instant visual fix

TIER 2 — Fix After Tier 1 (UX + Data Quality)

5. Fix player names in all variance pages (Bug 6)
   High visibility, easy fix — just join players table in variance route

6. Check and clear seed data if present (Bug 7)
   Run the SQL check first to confirm before deleting anything

7. Add variance to startup warmup (Bug 8)

TIER 3 — Security + Polish

8. Apply Clerk auth middleware (Bug 4)
   Correct but lower urgency for a single-user tool

9. Verify lineup factory works end-to-end after Tier 1+2 (Bug 9)
```

---

## ACCEPTANCE TEST — 14 CRITERIA

All 14 should pass for the build to be considered complete:

```
[ ] 1. Force Sync completes all 5 jobs in sequence with SSE step labels
[ ] 2. Without clicking Force Sync, PP lines update automatically within 15 minutes
[ ] 3. A player who gets injured auto-shows in Injuries page within 20 minutes
[ ] 4. Slate Board shows under 500 rows with correct today-only filtering
[ ] 5. Fatigue Tracker shows REAL player names (not stat types) with real scores
[ ] 6. A confirmed back-to-back player shows isBackToBack=true and fatigueScore≥35
[ ] 7. Variance Stability Radar shows player names, not stat categories
[ ] 8. Settings page shows LIVE MODE (not MOCK MODE)
[ ] 9. Optimizer results survive page navigation (localStorage persistence)
[ ] 10. Alerts: "Clear Read" removes dimmed alerts. "Clear All" empties the panel.
[ ] 11. GET /api/debug/calibration returns sampleSize and source label
[ ] 12. Lineup Factory returns 5 diverse lineups when run on a populated slate
[ ] 13. Player photos/avatars appear in Slate Board rows and Entry Builder picks
[ ] 14. No seed player names (Jayson Tatum, Nikola Jokic) appear in production DB
```

---

## SUMMARY TABLE

| Issue | Severity | File | Status |
|---|---|---|---|
| Cron all stubs — no auto-sync | 🔴 Critical | lib/cron.ts | NOT FIXED |
| syncInjuries trapped in routes | 🔴 Critical | routes/sync.ts | NOT FIXED |
| fatigue_data never populated | 🔴 Critical | lib/variance/index.ts | NOT FIXED |
| Auth uses req.query.userId | 🔴 Critical | routes/entries.ts | NOT FIXED |
| DATA_MODE defaults to mock | 🔴 Critical | routes/data-health.ts | NOT FIXED |
| Variance pages show statType not player name | 🟡 Medium | pages/variance/*.tsx | NOT FIXED |
| Seed data may be in production DB | 🟡 Medium | scripts/seed*.ts | CHECK NEEDED |
| Variance not in startup warmup | 🟡 Medium | index.ts | NOT FIXED |
| Mobile table responsive classes | ✅ Fixed | slate-board.tsx | DONE |
| Slate board pagination + useMemo | ✅ Fixed | slate-board.tsx | DONE |
| Optimizer localStorage persistence | ✅ Fixed | slate-board.tsx | DONE |
| Alert clear/delete routes | ✅ Fixed | routes/alerts.ts | DONE |
| Alert clear buttons in UI | ✅ Fixed | pages/dashboard.tsx | DONE |
| DB transactions in entries | ✅ Fixed | routes/entries.ts | DONE |
| Zod validation on entries | ✅ Fixed | routes/entries.ts | DONE |
| lastSyncedAt on pp_lines | ✅ Fixed | schema/pp-lines.ts | DONE |
| Date-based deactivation | ✅ Fixed | lib/sync/prizepicks.ts | DONE |
| Injuries sync real (ESPN) | ✅ Fixed | routes/sync.ts | DONE |
| AI chat BASE URL fixed | ✅ Fixed | pages/ai-chat.tsx | DONE |
| Player photos component | ✅ Fixed | components/ui/player-avatar.tsx | DONE |
| Variance engine schemas | ✅ Fixed | lib/db/src/schema/ | DONE |
| Variance compute logic | ✅ Fixed | lib/variance/index.ts | DONE |
| All pages routed | ✅ Fixed | App.tsx | DONE |
| All routes registered | ✅ Fixed | routes/index.ts | DONE |
| Lineup Factory backend | ✅ Fixed | routes/lineup-factory.ts | DONE |

