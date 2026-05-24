# VibeMeGood — Slate Bloat Fix
### Root cause: 10,610+ stale lines accumulated in pp_lines table.
### Fix: one-time cleanup + structural prevention.

---

## WHY THIS HAPPENED

The PP sync deactivation uses:
```typescript
await db.update(ppLinesTable)
  .set({ isActive: false })
  .where(inArray(ppLinesTable.id, staleIds));
```

When `staleIds` contains 10,000+ IDs, PostgreSQL generates a query like:
`WHERE id IN (1, 2, 3, ... 10000)` — this frequently exceeds PostgreSQL's
query complexity limits and either times out or fails silently.
The update never completes. Every sync adds new lines. Nothing gets deactivated.
The table grows indefinitely.

---

## STEP 1 — One-Time Database Cleanup (Run This First)

This is a direct SQL migration. Run it once in the Replit PostgreSQL shell or
via a one-time migration script. It wipes all lines older than 24 hours immediately.

```sql
-- Step 1: See how bad the damage is
SELECT
  COUNT(*) as total_active,
  COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '24 hours') as stale,
  COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '24 hours') as current
FROM pp_lines
WHERE is_active = true;

-- Step 2: Deactivate all stale lines (older than 24 hours)
-- This is safe — today's lines were just updated by the last PP sync
UPDATE pp_lines
SET is_active = false, updated_at = NOW()
WHERE is_active = true
  AND updated_at < NOW() - INTERVAL '24 hours';

-- Step 3: Verify — should now show only today's real props (~200-500)
SELECT COUNT(*) FROM pp_lines WHERE is_active = true;

-- Step 4: Clean up orphaned prop scores for now-inactive lines
DELETE FROM prop_scores
WHERE pp_line_id IN (
  SELECT id FROM pp_lines WHERE is_active = false
);

-- Step 5 (optional): Vacuum the table to reclaim disk space
VACUUM ANALYZE pp_lines;
VACUUM ANALYZE prop_scores;
```

**Run this as a Replit script or Drizzle migration. Do it before running any
other fix below.**

---

## STEP 2 — Add `lastSyncedAt` to pp_lines Schema

Instead of relying on `isActive` being perfectly maintained (which requires
deactivation to work at scale), add a `lastSyncedAt` timestamp. Every time
a line appears in a PP sync, update this field. Then every query filters
by `lastSyncedAt >= NOW() - INTERVAL '12 hours'`.

Today's slate = lines synced in the last 12 hours. Always. Automatically.
No deactivation needed to keep the slate clean.

**File:** `lib/db/src/schema/pp-lines.ts`

```typescript
export const ppLinesTable = pgTable("pp_lines", {
  // ... existing fields unchanged ...
  isActive: boolean("is_active").notNull().default(true),
  openedAt: timestamp("opened_at").notNull(),

  // ADD THIS:
  lastSyncedAt: timestamp("last_synced_at"),  // updated every time line appears in PP sync
});
```

**Run the migration:**
```sql
ALTER TABLE pp_lines ADD COLUMN last_synced_at TIMESTAMP;

-- Backfill: set lastSyncedAt = updatedAt for all active lines
UPDATE pp_lines SET last_synced_at = updated_at WHERE is_active = true;

-- Index for fast date filtering
CREATE INDEX idx_pp_lines_last_synced ON pp_lines (last_synced_at DESC)
  WHERE is_active = true;
```

---

## STEP 3 — Update the PP Sync to Stamp lastSyncedAt

**File:** `artifacts/api-server/src/lib/sync/prizepicks.ts`

Every time a line is upserted (new or existing), update `lastSyncedAt`:

```typescript
// When upserting a new line:
const [newLine] = await db.insert(ppLinesTable).values({
  playerId: player.id,
  statType,
  lineValue: lineValue.toString(),
  lineType,
  directionalityType: "over_under",
  isActive: true,
  openedAt: new Date(),
  lastSyncedAt: new Date(),    // ← ADD
}).returning();

// When updating an existing line:
await db.update(ppLinesTable)
  .set({
    lineValue: lineValue.toString(),
    lineType,
    lastSyncedAt: new Date(),   // ← ADD
    updatedAt: new Date(),
  })
  .where(eq(ppLinesTable.id, existing.id));
```

---

## STEP 4 — Fix the Deactivation to Not Use inArray at Scale

The `inArray()` deactivation works fine for small counts but fails silently
for 10,000+ IDs. Replace it with a direct SQL update using a subquery:

**File:** `artifacts/api-server/src/lib/sync/prizepicks.ts`

Replace the current deactivation block at the bottom of `syncPpLines()`:

```typescript
// REMOVE THIS (fails at scale):
// const allActive = await db.select({ id: ppLinesTable.id })
//   .from(ppLinesTable)
//   .where(eq(ppLinesTable.isActive, true));
// const staleIds = allActive.map(l => l.id).filter(id => !seenLineIds.has(id));
// await db.update(ppLinesTable).set({ isActive: false }).where(inArray(...));

// REPLACE WITH THIS (works at any scale):
// Deactivate any line that wasn't synced in this run
// Uses lastSyncedAt — no ID list needed
const deactivationCutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

const deactivated = await db
  .update(ppLinesTable)
  .set({ isActive: false, updatedAt: new Date() })
  .where(and(
    eq(ppLinesTable.isActive, true),
    // Line wasn't touched in this sync session
    or(
      isNull(ppLinesTable.lastSyncedAt),
      lt(ppLinesTable.lastSyncedAt, deactivationCutoff),
    )
  ))
  .returning({ id: ppLinesTable.id });

if (deactivated.length > 0) {
  logger.info({ count: deactivated.length }, "Deactivated stale PP lines");
}
```

This uses a date comparison instead of `IN (id1, id2, id3, ...)`. PostgreSQL handles
a date comparison efficiently even on a table with millions of rows.

---

## STEP 5 — Filter Every Route to Today's Slate Only

Now that `lastSyncedAt` exists, add it as a filter in every route that reads PP lines.
This ensures even if a line somehow stays `isActive = true`, it won't show up
unless it was synced today.

**File:** `artifacts/api-server/src/routes/slate.ts`

```typescript
// Add this helper at the top:
function todayFilter() {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000); // last 12 hours
  return and(
    eq(ppLinesTable.isActive, true),
    or(
      isNull(ppLinesTable.lastSyncedAt),
      gte(ppLinesTable.lastSyncedAt, cutoff),
    )
  );
}

// In the main query, replace:
.where(eq(ppLinesTable.isActive, true))

// With:
.where(todayFilter())
```

**File:** `artifacts/api-server/src/routes/market-intel.ts`

Same change — replace `eq(ppLinesTable.isActive, true)` with `todayFilter()`.

**File:** `artifacts/api-server/src/routes/dashboard.ts`

```typescript
// Replace:
db.select().from(ppLinesTable).where(eq(ppLinesTable.isActive, true))

// With:
const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
db.select().from(ppLinesTable).where(
  and(
    eq(ppLinesTable.isActive, true),
    gte(ppLinesTable.lastSyncedAt, cutoff),
  )
)
```

**File:** `artifacts/api-server/src/routes/optimizer.ts`

Same filter pattern — only optimize picks from today's active slate.

---

## STEP 6 — Show a "Slate Not Loaded" State When No Current Props

After the cleanup, if a user opens the app before the first PP sync of the day runs,
there will be zero props. Show a clear, actionable state instead of an empty table.

**File:** `artifacts/prizepicks/src/pages/slate-board.tsx`

```tsx
// Replace or supplement the existing empty state:
{playerRows.length === 0 && !slateLoading && !miLoading && (
  <tr>
    <td colSpan={14} className="py-16 text-center">
      <div className="space-y-3">
        <RefreshCw className="w-8 h-8 text-muted-foreground/30 mx-auto" />
        <div>
          <p className="text-sm font-mono font-semibold text-foreground">
            Today's slate hasn't loaded yet
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PrizePicks props sync every 10 minutes. Last sync may not have
            found any active props for the selected filters.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleForceSync}
          className="font-mono text-xs bg-primary/20 border border-primary/30 text-primary gap-1.5"
        >
          <RefreshCw className="w-3 h-3" /> Force Sync Now
        </Button>
        <p className="text-[10px] text-slate-600 font-mono">
          If no games are scheduled today, the slate will be empty until tomorrow.
        </p>
      </div>
    </td>
  </tr>
)}
```

---

## STEP 7 — Reduce Dashboard Query Load

The dashboard was querying ALL active lines to compute stats. With 10,610 lines
that was enormous. After the cleanup it'll be fast, but also scope it properly:

**File:** `artifacts/api-server/src/routes/dashboard.ts`

```typescript
// Add the 12-hour filter to the activeLines query:
const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);

const activeLines = await db.select()
  .from(ppLinesTable)
  .where(and(
    eq(ppLinesTable.isActive, true),
    gte(ppLinesTable.lastSyncedAt, cutoff),  // ← ADD THIS
  ));

// The gatedPropsCount will now only count props from today's slate
// Instead of 10,610 it should show something like 12-40 (legitimate gated props)
```

---

## WHAT THE NUMBERS SHOULD LOOK LIKE AFTER THE FIX

| Metric | Before | After |
|---|---|---|
| Active PP lines in DB | 10,610+ | 200–500 |
| Dashboard query time | ~3–8s | <200ms |
| Gated / NO-PLAY count | 10,610 | 5–30 (legitimate) |
| Slate Board row count | 10,610 | 200–500 |
| Market-intel route time | ~5–15s | <500ms |

The remaining "gated" props after the fix are legitimate — they're props from today's
slate where your projection model can't produce a confident estimate (insufficient
recent data, injured player, very new player, etc.). That's the correct behavior.

---

## CRON SCHEDULE VERIFICATION

After the fix, confirm the cron is running on schedule. In Replit, the PP sync
runs every 10 minutes. If the server restarts (Replit free tier sleeps), the cron
restarts too. Check the `sync_runs` table to see if syncs are firing:

```sql
-- Verify syncs are running
SELECT job_name, status, records_processed, started_at, finished_at
FROM sync_runs
ORDER BY started_at DESC
LIMIT 20;

-- If you see gaps > 15 minutes, the cron isn't firing reliably
-- Replit Pro keeps the server always-on — verify Pro is active
```

---

## IMPLEMENTATION ORDER

```
1. Run the SQL cleanup (Step 1) — immediate relief, no code changes needed
   After this: activeLines drops from 10,610 to ~200-500 immediately

2. Add lastSyncedAt column migration (Step 2)
   This is the structural prevention

3. Update PP sync to stamp lastSyncedAt (Step 3)
   Without this, the column stays null and Step 5 filters break

4. Fix deactivation to not use inArray at scale (Step 4)
   Prevents accumulation from ever happening again

5. Update route filters to use todayFilter() (Step 5)
   Final guard: even if something slips through, it won't show

6. Update dashboard query to use 12-hour filter (Step 7)
   KPI numbers now accurately reflect today's slate only

7. Update empty state message (Step 6)
   Tells user what to do when slate hasn't synced yet
```

---

## ACCEPTANCE TEST

```
[ ] After Step 1 SQL cleanup:
    Dashboard shows <500 active props (not 10,000+)
    "Gated / NO-PLAY" count is under 50
    Dashboard loads in under 1 second

[ ] After full fix:
    Slate Board loads in under 2 seconds with 200-500 rows
    All rows are from today's active PrizePicks slate
    No NFL/NHL/MLB off-season players appear when sport is out of season
    Force Sync updates the slate within 30 seconds

[ ] Off-season behavior:
    During NBA off-season, NBA props don't appear
    During NFL off-season, NFL props don't appear
    App shows "no games scheduled" message, not a pile of stale props

[ ] 24 hours later:
    Yesterday's props are gone automatically (lastSyncedAt filter)
    Today's new slate loads with today's fresh props
    No manual cleanup needed
```

