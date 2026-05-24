# VibeMeGood — Three Bug Fixes
### Alerts clear, lineup refresh, slate board performance

---

## FIX 1: Alerts — Add "Clear All" (Delete, Not Just Mark Read)

### The Problem
The AlertsPanel has "Mark all read" which dims alerts to 40% opacity.
There is NO way to delete them. Read alerts permanently clutter the panel.
The backend also has no delete endpoint.

### Backend Fix — Add delete route

**File:** `artifacts/api-server/src/routes/alerts.ts`

Add these two endpoints after the existing `read-all` route:

```typescript
// Delete a single alert
router.delete("/alerts/:id", async (req, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await db.delete(alertsTable)
      .where(eq(alertsTable.id, Number(req.params.id)));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Clear all read alerts (most useful — clears the clutter)
router.delete("/alerts/clear-read", async (req, res) => {
  try {
    await db.delete(alertsTable)
      .where(eq(alertsTable.isRead, true));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Clear ALL alerts regardless of read status
router.delete("/alerts/clear-all", async (req, res) => {
  try {
    await db.delete(alertsTable);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});
```

**Important:** In Express, `router.delete("/alerts/clear-read", ...)` must be registered BEFORE `router.delete("/alerts/:id", ...)` — otherwise Express will try to match "clear-read" as an `:id` parameter.

### Frontend Fix — Add Clear buttons to AlertsPanel

**File:** `artifacts/prizepicks/src/pages/dashboard.tsx` — inside `AlertsPanel`

```tsx
// 1. Add the API call functions at the top of AlertsPanel component:
const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

async function handleClearRead() {
  await fetch(`${base}/api/alerts/clear-read`, { method: "DELETE" });
  await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
  await qc.invalidateQueries({ queryKey: summaryKey });
}

async function handleClearAll() {
  await fetch(`${base}/api/alerts/clear-all`, { method: "DELETE" });
  await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
  await qc.invalidateQueries({ queryKey: summaryKey });
}

async function handleDeleteOne(id: number) {
  await fetch(`${base}/api/alerts/${id}`, { method: "DELETE" });
  await qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
  await qc.invalidateQueries({ queryKey: summaryKey });
}

// 2. Update the DialogHeader to show both Mark All Read AND Clear buttons:
<DialogHeader className="flex flex-row items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
  <div className="flex items-center gap-2">
    <DialogTitle className="font-mono text-sm uppercase tracking-wider">Alerts</DialogTitle>
    {unreadCount > 0 && (
      <span className="text-[10px] font-mono bg-rose-900/50 text-rose-400 border border-rose-800/60 px-1.5 py-0.5 rounded">
        {unreadCount} unread
      </span>
    )}
  </div>
  <div className="flex items-center gap-2">
    {/* Mark all read — only when there are unread */}
    {unreadCount > 0 && (
      <Button
        size="sm" variant="outline" onClick={handleMarkAll}
        disabled={markAll.isPending}
        className="font-mono text-xs h-7 border-slate-700 text-slate-300 gap-1"
      >
        <CheckCheck className="w-3 h-3" />
        Mark read
      </Button>
    )}
    {/* Clear read — only when there are read alerts */}
    {alerts && alerts.some((a: any) => a.isRead) && (
      <Button
        size="sm" variant="outline" onClick={handleClearRead}
        className="font-mono text-xs h-7 border-slate-700 text-slate-400 hover:text-rose-400 hover:border-rose-800 gap-1"
      >
        <Trash2 className="w-3 h-3" />
        Clear read
      </Button>
    )}
    {/* Clear all — always visible when alerts exist */}
    {alerts && alerts.length > 0 && (
      <Button
        size="sm" variant="outline" onClick={handleClearAll}
        className="font-mono text-xs h-7 border-rose-900 text-rose-500 hover:bg-rose-950/40 gap-1"
      >
        <Trash2 className="w-3 h-3" />
        Clear all
      </Button>
    )}
  </div>
</DialogHeader>

// 3. Add a delete button (×) on each individual alert row:
// Inside the alerts.map(), at the end of each alert div:
<button
  onClick={() => handleDeleteOne(a.id)}
  className="shrink-0 p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
  title="Delete alert"
>
  <X className="w-3.5 h-3.5" />
</button>
```

Add `Trash2, X` to the lucide-react import at the top of dashboard.tsx.

### Acceptance
- "Clear read" button appears after marking alerts as read — removes dimmed alerts
- "Clear all" button removes everything immediately
- Individual × button on each alert removes just that one
- Alert count in the bell icon updates immediately after clearing
- Empty state ("No alerts") shows correctly after clearing all

---

## FIX 2: Lineup Refresh — Clear Error State + Persistent Results

### The Problem
The optimizer lives in the Slate Board as a side panel. When the user:
1. Runs the optimizer → results appear
2. Navigates away or refreshes the page → results are GONE
3. Returns to the Slate Board → empty panel, no indication they need to re-run

The `optLoaded` state variable resets on every page mount. The user sees a blank
optimizer section and doesn't know they need to click "Run" again. This is the
"lineups haven't been refreshed" experience.

Additionally, when `optResults.length === 0` after running, the message says
"No Goblin OVER picks available. Try syncing props first." — this is confusing
if the slate IS loaded but just has no goblin picks.

### Fix A — Clear Initial State Message

**File:** `artifacts/prizepicks/src/pages/slate-board.tsx`

Find the optimizer panel section and add an explicit initial state when `!optLoaded`:

```tsx
{/* Replace the current empty state when !optLoaded with this: */}
{!optLoaded && (
  <div className="py-8 text-center space-y-2 px-4">
    <Zap className="w-7 h-7 text-muted-foreground/30 mx-auto" />
    <p className="text-sm font-mono text-muted-foreground">
      Click Run to generate lineup suggestions
    </p>
    <p className="text-[10px] text-slate-600 font-mono">
      Results reset on page reload — click Run to refresh
    </p>
  </div>
)}
```

### Fix B — Persist Last Optimizer Results to localStorage

After a successful run, save results to localStorage so they survive page refreshes.

```tsx
// Near the top of the Slate Board component, replace useState for optResults:
const STORAGE_KEY = "vibe_optimizer_results";
const STORAGE_TIMESTAMP_KEY = "vibe_optimizer_ts";

// Load persisted results on mount
const [optResults, setOptResults] = useState<any[]>(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const ts = localStorage.getItem(STORAGE_TIMESTAMP_KEY);
    // Only restore if results are less than 6 hours old
    if (stored && ts && Date.now() - Number(ts) < 6 * 60 * 60 * 1000) {
      return JSON.parse(stored);
    }
  } catch {}
  return [];
});

const [optLoaded, setOptLoaded] = useState<boolean>(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const ts = localStorage.getItem(STORAGE_TIMESTAMP_KEY);
    return !!(stored && ts && Date.now() - Number(ts) < 6 * 60 * 60 * 1000);
  } catch {}
  return false;
});

// Update the runOptimizer function to also persist results:
async function runOptimizer() {
  // ... existing optimizer logic ...
  const results = /* result from optimizer */;
  setOptResults(results);
  setOptLoaded(true);
  // Persist to localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  localStorage.setItem(STORAGE_TIMESTAMP_KEY, String(Date.now()));
}
```

### Fix C — Change "Run" to "Re-run" When Results Exist + Add Refresh Button

```tsx
// Update the Run button to show context-aware label:
<Button
  size="sm"
  onClick={runOptimizer}
  disabled={isOptimizing}
  className="ml-auto font-mono text-xs bg-violet-700 hover:bg-violet-600 gap-1"
>
  {isOptimizing ? (
    <><RefreshCw className="w-3 h-3 animate-spin" /> Running...</>
  ) : optLoaded ? (
    <><RefreshCw className="w-3 h-3" /> Re-run</>
  ) : (
    <><Zap className="w-3 h-3" /> Run</>
  )}
</Button>

// When results exist, also show a timestamp + stale warning:
{optLoaded && (
  <div className="text-[10px] font-mono text-slate-600 text-right px-1">
    {(() => {
      const ts = localStorage.getItem("vibe_optimizer_ts");
      if (!ts) return null;
      const mins = Math.floor((Date.now() - Number(ts)) / 60000);
      if (mins > 60) return <span className="text-amber-600">Results {mins}m old — re-run for fresh picks</span>;
      return <span>Updated {mins}m ago</span>;
    })()}
  </div>
)}
```

### Fix D — Smarter Empty State After Running

```tsx
{optLoaded && optResults.length === 0 && (
  <div className="py-6 text-center space-y-2 text-xs font-mono text-muted-foreground px-4">
    <p>No Goblin OVER picks found for {optPickCount} picks.</p>
    <div className="space-y-1 text-[10px] text-slate-600">
      <p>Try: reducing pick count, or Force Sync to load today's slate.</p>
      <p>If the slate is loaded, check that Goblin lines exist for today.</p>
    </div>
    <Button size="sm" variant="outline" onClick={() => {
      const syncBtn = document.querySelector("[data-force-sync]") as HTMLElement;
      syncBtn?.click();
    }} className="text-xs font-mono h-7 border-slate-700 gap-1.5 mt-2">
      <RefreshCw className="w-3 h-3" /> Force Sync Now
    </Button>
  </div>
)}
```

Add `data-force-sync` attribute to the Force Sync button so the above can find it.

### Acceptance
- Navigating away from Slate Board and back: last optimizer results still show
- Results older than 6 hours: show amber "stale" warning, prompt to re-run
- Fresh page load: if recent results exist, show them immediately
- "Run" → "Re-run" label when results already exist
- Empty state after running explains clearly what to do next

---

## FIX 3: Slate Board Crashes With Too Many Players — Virtual Scrolling

### The Problem
`playerRows.map((row) => <TableRow>...</TableRow>)` at line 481 renders ALL rows
simultaneously. With 300-500+ props (which PrizePicks regularly publishes across all sports),
this creates hundreds of DOM nodes at once, each with multiple children, computed styles,
tooltips, and event handlers. React's reconciliation bogs down. The browser tab freezes
or crashes.

### The Solution — @tanstack/react-virtual

Virtual scrolling renders ONLY the rows currently visible in the viewport (typically 12-15 rows).
Scroll up or down and it swaps rows in/out seamlessly. 500 rows or 5000 rows — same performance.

**Step 1 — Install the package:**

```bash
pnpm add @tanstack/react-virtual
```

**Step 2 — Refactor the table rendering**

**File:** `artifacts/prizepicks/src/pages/slate-board.tsx`

```tsx
// Add to imports at top:
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

// Inside the SlateBoard component, add a ref for the scroll container:
const tableScrollRef = useRef<HTMLDivElement>(null);

// Create the virtualizer (place this inside the component, before the return):
const rowVirtualizer = useVirtualizer({
  count: playerRows.length,
  getScrollElement: () => tableScrollRef.current,
  estimateSize: () => 52,    // estimated row height in px — adjust if your rows are taller/shorter
  overscan: 8,               // render 8 extra rows above and below viewport for smoother scrolling
});
```

**Step 3 — Replace the table body rendering**

Find this block (around line 444-530):
```tsx
<div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col min-h-0">
  <div className="overflow-auto flex-1">
    <table ...>
      <thead>...</thead>
      <tbody>
        {/* LOADING SKELETON */}
        {(slateLoading || miLoading) ? (
          Array.from({ length: 10 }).map(...)
        ) : playerRows.length === 0 ? (
          <empty state />
        ) : (
          playerRows.map((row) => { ... })  // ← THIS IS THE PROBLEM
        )}
      </tbody>
    </table>
  </div>
</div>
```

Replace with:
```tsx
<div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col min-h-0">
  {/* Scroll container — must have fixed height for virtualizer to work */}
  <div
    ref={tableScrollRef}
    className="overflow-auto flex-1"
    style={{ contain: "strict" }}  // CSS containment improves scroll performance
  >
    <table className="w-full border-collapse">
      {/* STICKY HEADER — stays in place while rows scroll */}
      <thead className="sticky top-0 z-10 bg-slate-900">
        {/* ... existing header rows unchanged ... */}
      </thead>

      {/* VIRTUAL BODY */}
      <tbody>
        {(slateLoading || miLoading) ? (
          // Loading skeleton — unchanged
          Array.from({ length: 10 }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: 14 }).map((_, j) => (
                <td key={j} className="p-2">
                  <Skeleton className="h-4 bg-slate-800" />
                </td>
              ))}
            </tr>
          ))
        ) : playerRows.length === 0 ? (
          // Empty state — unchanged
          <tr>
            <td colSpan={14} className="py-16 text-center text-xs font-mono text-muted-foreground">
              {notSynced ? "No props loaded — click Force Sync" : "No props match the current filters"}
            </td>
          </tr>
        ) : (
          <>
            {/* Virtual spacer — tells the browser the full height of the list */}
            <tr style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
              <td colSpan={14} className="p-0">
                {/* Absolutely positioned virtual rows */}
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const row = playerRows[virtualItem.index];
                  const isNoPlay = row.actionTag === "NO-PLAY";
                  const proj: OurProjection | null = row.ourProjection ?? null;

                  return (
                    <table
                      key={virtualItem.key}
                      className="w-full border-collapse absolute top-0 left-0"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                        height: `${virtualItem.size}px`,
                      }}
                    >
                      <tbody>
                        <tr
                          className={`border-b border-slate-800/60 transition-colors ${
                            isNoPlay
                              ? "opacity-40 hover:opacity-60"
                              : row.isWatched
                              ? "bg-amber-950/10 hover:bg-amber-950/20"
                              : "hover:bg-slate-800/40"
                          } cursor-pointer`}
                          onClick={() => setSelectedPropId(row.ppLineId)}
                        >
                          {/* ... all existing TableCell content unchanged ... */}
                        </tr>
                      </tbody>
                    </table>
                  );
                })}
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  </div>
</div>
```

**Note on the virtual row approach:** The above uses absolute positioning inside a relative container. An alternative that's simpler to implement is the `div`-based virtual list (no `<table>` wrapping), but that requires converting table rows to divs. The approach above preserves the existing table structure.

**Simpler Alternative If the Table Approach is Complex**

If the virtual table approach is tricky to implement cleanly with the existing table structure, use this instead — it's simpler and solves the crash:

**Approach B: Paginate with "Show More"**

```tsx
// Add to component state:
const [visibleCount, setVisibleCount] = useState(75);

// Replace playerRows.map with:
const visibleRows = playerRows.slice(0, visibleCount);

// In the tbody:
{visibleRows.map((row) => {
  // ... existing row rendering unchanged
})}

// After the closing </tbody>, add a "Show more" row if there are more:
{playerRows.length > visibleCount && (
  <tr>
    <td colSpan={14} className="py-3 text-center">
      <Button
        size="sm" variant="outline"
        onClick={() => setVisibleCount(c => c + 75)}
        className="font-mono text-xs border-slate-700 text-slate-400 gap-1.5"
      >
        Show {Math.min(75, playerRows.length - visibleCount)} more
        <span className="text-slate-600">({playerRows.length - visibleCount} remaining)</span>
      </Button>
    </td>
  </tr>
)}
```

Reset `visibleCount` to 75 whenever filters change:
```tsx
// Add this effect:
useEffect(() => {
  setVisibleCount(75);
}, [lineTypeFilter, sport, statTypeFilter, searchQuery, minEdge]);
```

This is less elegant than virtual scrolling but trivially simple to implement and completely solves the crash. 75 rows renders comfortably. The user can load more on demand.

**Approach B is recommended if virtual scrolling causes implementation issues.**
Implement virtual scrolling (Approach A) if time allows — it's the better UX.

### Additional Performance Fix — Debounce the Search Input

The search filter currently re-renders on every keystroke. With 500 rows this is expensive.
Add a 150ms debounce:

```tsx
import { useMemo, useState } from "react";

// Replace direct searchQuery usage in the filter with a debounced version:
const [searchInput, setSearchInput] = useState("");
const [searchQuery, setSearchQuery] = useState("");

useEffect(() => {
  const timer = setTimeout(() => setSearchQuery(searchInput), 150);
  return () => clearTimeout(timer);
}, [searchInput]);

// In the search input:
<Input
  value={searchInput}
  onChange={e => setSearchInput(e.target.value)}
  placeholder="Search player..."
  ...
/>
```

### Additional Performance Fix — Memoize the Filtered/Sorted Row List

```tsx
// Wrap the filtering and sorting logic in useMemo so it only recalculates
// when the inputs actually change:
const playerRows = useMemo(() => {
  let rows = allRows.filter(r => r.pickCategory !== "team");
  if (lineTypeFilter !== "all") rows = rows.filter(r => r.lineType === lineTypeFilter);
  if (minEdge) rows = rows.filter(r => r.edgeScore != null && r.edgeScore >= parseFloat(minEdge));
  if (sport !== "all") rows = rows.filter(r => r.sport === sport);
  if (searchQuery) rows = rows.filter(r =>
    r.playerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.teamAbbr ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );
  // sort
  return rows.sort(/* existing sort logic */);
}, [allRows, lineTypeFilter, minEdge, sport, searchQuery, sortCol, sortDir]);
```

Without `useMemo`, this filtering and sorting runs on every render — even renders triggered by unrelated state changes (like a tooltip hover).

---

## PRIORITY ORDER

```
1. Fix 3 first (slate board crash) — most critical, currently unusable
   → Implement Approach B (paginate) immediately for quick fix
   → Implement Approach A (virtual scroll) as follow-up for best UX

2. Fix 1 (clear alerts) — quick backend + UI change
   → Backend: 3 new DELETE routes
   → Frontend: 2 new buttons + per-row × button

3. Fix 2 (lineup refresh) — state persistence + UX clarity
   → localStorage persistence is the core fix
   → Updated button label and empty state message
```

---

## ACCEPTANCE TEST

```
ALERTS
[ ] Open alerts dialog. "Clear read" button appears after marking alerts read.
[ ] Clicking "Clear read" removes dimmed alerts immediately.
[ ] Clicking "Clear all" removes all alerts. Empty state shows.
[ ] Individual × button on each alert removes just that one.
[ ] Alert count in bell icon updates to 0 after clearing all.

LINEUP REFRESH
[ ] Run optimizer → get results → navigate to Injuries page → come back.
    Optimizer results should STILL be there (not blank).
[ ] Refresh the browser tab.
    If results are less than 6 hours old, they should reappear.
[ ] After running, button shows "Re-run" not "Run".
[ ] If results are over 60 minutes old, amber "stale" warning appears.
[ ] Empty state after running says "No Goblin OVER picks found" + actionable next steps.

SLATE BOARD PERFORMANCE
[ ] Load slate with ALL sports selected (most props).
    Table should render without freezing or crashing.
[ ] Scroll through 200+ rows smoothly without lag.
[ ] Changing filters is instant (no delay or jank).
[ ] Search input responds while typing (no freeze on keystroke).
[ ] "Show more" button (Approach B) loads next 75 rows when clicked.
```

