---
name: GPP narrative filter null-guard rule
description: When GPP filter data (gameTotal, paceTier, sharpSignal) is null, the prop must be INCLUDED, not excluded — data absence = unknown, not disqualified.
---

## Rule

All three GPP narrative filters in lineup-factory must use the pattern:
**"only exclude when data is present AND doesn't match"**, never exclude on null.

```typescript
// CORRECT — includes props with no game total data
if (minGameTotal !== undefined && p.gameTotal !== null && p.gameTotal < minGameTotal) return false;

// CORRECT — includes props with no pace data
if (pacePreference === "fast" && p.paceTier !== null && p.paceTier !== "fast") return false;

// WRONG — (null || value < threshold) excludes ALL props when table is empty
if (minGameTotal !== undefined && (p.gameTotal === null || p.gameTotal < minGameTotal)) return false;

// WRONG — null !== "fast" is always true, so all null-pace props get excluded
if (pacePreference === "fast" && p.paceTier !== "fast") return false;
```

**Why:** `game_environment` is always 0 rows (never populated). `team_pace_ratings` is NBA-only (sparse). `line_move_events.sharpSignal` only appears after a real line move ≥ 0.5 is detected by the external-odds sync. Treating null as "doesn't qualify" silently eliminates every prop, generating zero lineups without a visible error.

**How to apply:** Any new filter added to the GPP eligible-prop pass must use the null-guard pattern above. If a filter data source is known to be sparse, document it and confirm the null guard is in place.
