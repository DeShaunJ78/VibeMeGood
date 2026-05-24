# VibeMeGood — Fatigue Tracker Fix
### Demo data showing because syncFatigueData() was never built.
### The fix uses data already in your database — no new API calls needed.

---

## ROOT CAUSE CHAIN

```
player_game_logs table already has gameDate + minutes per player
    BUT no syncFatigueData() function reads it
        → fatigue_data table is empty (or doesn't exist)
            → GET /api/fatigue returns []
                → Frontend detects empty → shows hardcoded demo players
```

The projection engine already populated `player_game_logs` with game dates
and minutes. Fatigue is completely derivable from that data right now.

---

## STEP 1 — Add fatigue_data Table

**File:** `lib/db/src/schema/fatigue-data.ts` (NEW FILE)

```typescript
import {
  pgTable, serial, integer, numeric, boolean,
  varchar, date, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const fatigueDataTable = pgTable("fatigue_data", {
  id:                  serial("id").primaryKey(),
  playerId:            integer("player_id").references(() => playersTable.id).notNull(),
  computedForDate:     date("computed_for_date").notNull(),   // today's date

  // Schedule signals
  lastGameDate:        date("last_game_date"),
  daysRest:            integer("days_rest"),                  // 0 = played yesterday, 1 = 1 day rest
  isBackToBack:        boolean("is_back_to_back").default(false),
  isThreeInFour:       boolean("is_three_in_four").default(false),
  gamesLast7Days:      integer("games_last_7_days"),

  // Load signals
  prevGameMinutes:     numeric("prev_game_minutes"),
  avgMinutesL5:        numeric("avg_minutes_l5"),
  prevGameHomeAway:    varchar("prev_game_home_away", { length: 4 }),  // home | away

  // Travel
  travelMiles:         integer("travel_miles"),
  timezoneShiftHours:  integer("timezone_shift_hours").default(0),

  // Computed score
  fatigueScore:        integer("fatigue_score").notNull(),    // 0 (rested) – 100 (exhausted)
  fatigueLabel:        varchar("fatigue_label", { length: 50 }),
  warnings:            varchar("warnings", { length: 500 }),  // comma-separated warning tags

  computedAt:          timestamp("computed_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("fatigue_data_unique").on(t.playerId, t.computedForDate),
}));

export type FatigueData = typeof fatigueDataTable.$inferSelect;
```

**Export from schema index:**

```typescript
// lib/db/src/schema/index.ts — add:
export * from "./fatigue-data";
```

**Run migration:**
```sql
CREATE TABLE fatigue_data (
  id SERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  computed_for_date DATE NOT NULL,
  last_game_date DATE,
  days_rest INTEGER,
  is_back_to_back BOOLEAN DEFAULT false,
  is_three_in_four BOOLEAN DEFAULT false,
  games_last_7_days INTEGER,
  prev_game_minutes NUMERIC,
  avg_minutes_l5 NUMERIC,
  prev_game_home_away VARCHAR(4),
  travel_miles INTEGER,
  timezone_shift_hours INTEGER DEFAULT 0,
  fatigue_score INTEGER NOT NULL,
  fatigue_label VARCHAR(50),
  warnings VARCHAR(500),
  computed_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fatigue_data_unique UNIQUE (player_id, computed_for_date)
);

CREATE INDEX idx_fatigue_data_date ON fatigue_data (computed_for_date DESC);
CREATE INDEX idx_fatigue_data_player ON fatigue_data (player_id);
```

---

## STEP 2 — Arena Coordinates for Travel Calculation

**File:** `artifacts/api-server/src/lib/sync/fatigue.ts` (NEW FILE)

```typescript
import { db } from "@workspace/db";
import {
  fatigueDataTable, playerGameLogsTable, ppLinesTable,
  playersTable, teamsTable,
} from "@workspace/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { logger } from "../logger";

// ─── Arena coordinates ───────────────────────────────────────────────────────
// Used to compute travel distance between games
// Key = NBA team abbreviation as stored in teams table

const ARENA_COORDS: Record<string, { lat: number; lon: number; tz: string }> = {
  LAL: { lat: 34.0430, lon: -118.2673, tz: "America/Los_Angeles" },
  LAC: { lat: 34.0430, lon: -118.2673, tz: "America/Los_Angeles" },
  GSW: { lat: 37.7680, lon: -122.3877, tz: "America/Los_Angeles" },
  PHX: { lat: 33.4457, lon: -112.0712, tz: "America/Phoenix"     },
  SAC: { lat: 38.5805, lon: -121.4991, tz: "America/Los_Angeles" },
  POR: { lat: 45.5316, lon: -122.6668, tz: "America/Los_Angeles" },
  OKC: { lat: 35.4634, lon: -97.5151,  tz: "America/Chicago"     },
  DEN: { lat: 39.7487, lon: -105.0077, tz: "America/Denver"      },
  UTA: { lat: 40.7683, lon: -111.9011, tz: "America/Denver"      },
  MIN: { lat: 44.9795, lon: -93.2760,  tz: "America/Chicago"     },
  DAL: { lat: 32.7905, lon: -96.8103,  tz: "America/Chicago"     },
  HOU: { lat: 29.7508, lon: -95.3621,  tz: "America/Chicago"     },
  MEM: { lat: 35.1381, lon: -90.0505,  tz: "America/Chicago"     },
  NOP: { lat: 29.9490, lon: -90.0820,  tz: "America/Chicago"     },
  SAS: { lat: 29.4270, lon: -98.4375,  tz: "America/Chicago"     },
  CHI: { lat: 41.8807, lon: -87.6742,  tz: "America/Chicago"     },
  IND: { lat: 39.7639, lon: -86.1555,  tz: "America/Indiana/Indianapolis" },
  MIL: { lat: 43.0450, lon: -87.9170,  tz: "America/Chicago"     },
  CLE: { lat: 41.4965, lon: -81.6882,  tz: "America/New_York"    },
  DET: { lat: 42.3410, lon: -83.0550,  tz: "America/Detroit"     },
  TOR: { lat: 43.6435, lon: -79.3791,  tz: "America/Toronto"     },
  BOS: { lat: 42.3662, lon: -71.0621,  tz: "America/New_York"    },
  NYK: { lat: 40.7505, lon: -73.9934,  tz: "America/New_York"    },
  BKN: { lat: 40.6827, lon: -73.9754,  tz: "America/New_York"    },
  PHI: { lat: 39.9012, lon: -75.1720,  tz: "America/New_York"    },
  WAS: { lat: 38.8981, lon: -77.0209,  tz: "America/New_York"    },
  ATL: { lat: 33.7573, lon: -84.3963,  tz: "America/New_York"    },
  CHA: { lat: 35.2251, lon: -80.8392,  tz: "America/New_York"    },
  ORL: { lat: 28.5392, lon: -81.3839,  tz: "America/New_York"    },
  MIA: { lat: 25.7814, lon: -80.1870,  tz: "America/New_York"    },
  // WNBA (shares arenas with NBA teams or has own)
  LVA: { lat: 36.0905, lon: -115.1771, tz: "America/Los_Angeles" },
  SEA: { lat: 47.6062, lon: -122.3321, tz: "America/Los_Angeles" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haversineDistanceMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function timezoneOffsetHours(tz1: string, tz2: string): number {
  // Rough timezone offset map (hours behind UTC)
  const offsets: Record<string, number> = {
    "America/Los_Angeles": -8, "America/Phoenix": -7, "America/Denver": -7,
    "America/Chicago": -6, "America/Indiana/Indianapolis": -5,
    "America/New_York": -5, "America/Detroit": -5, "America/Toronto": -5,
  };
  return Math.abs((offsets[tz1] ?? -5) - (offsets[tz2] ?? -5));
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.round(Math.abs(b - a) / (1000 * 60 * 60 * 24));
}

function computeFatigueScore(data: {
  daysRest:           number;
  isBackToBack:       boolean;
  isThreeInFour:      boolean;
  gamesLast7:         number;
  prevGameMinutes:    number;
  travelMiles:        number;
  timezoneShift:      number;
}): { score: number; label: string; warnings: string[] } {
  let score = 0;
  const warnings: string[] = [];

  // Rest penalty — most impactful signal
  if (data.isBackToBack) {
    score += 35;
    warnings.push("back_to_back");
  } else if (data.daysRest === 2) {
    score += 8;
  } else if (data.daysRest >= 4) {
    score -= 10;  // well rested = negative fatigue = advantage
  }

  // Three in four nights
  if (data.isThreeInFour) {
    score += 20;
    warnings.push("three_in_four");
  }

  // Heavy workload in last 7 days
  if (data.gamesLast7 >= 5) { score += 10; warnings.push("heavy_schedule"); }
  else if (data.gamesLast7 === 4) score += 5;

  // Previous game heavy minutes
  if (data.prevGameMinutes >= 40) { score += 10; warnings.push("heavy_minutes"); }
  else if (data.prevGameMinutes >= 36) score += 5;

  // Travel penalty
  if (data.travelMiles > 2000) { score += 15; warnings.push("long_travel"); }
  else if (data.travelMiles > 1000) score += 8;
  else if (data.travelMiles > 500) score += 4;

  // Timezone shift (circadian disruption)
  if (data.timezoneShift >= 3) { score += 10; warnings.push("timezone_shift"); }
  else if (data.timezoneShift >= 2) score += 5;

  score = Math.max(0, Math.min(100, score));

  const label =
    score >= 70 ? "Heavy fatigue" :
    score >= 50 ? "Elevated fatigue" :
    score >= 30 ? "Mild fatigue" :
    score <= -5 ? "Well rested — advantage" :
    "Normal rest";

  return { score, label, warnings };
}
```

---

## STEP 3 — The Sync Function (reads existing player_game_logs)

Add this to `artifacts/api-server/src/lib/sync/fatigue.ts`:

```typescript
// ─── Main sync ───────────────────────────────────────────────────────────────

export async function syncFatigueData(): Promise<number> {
  const today = new Date().toISOString().split("T")[0]; // "2026-05-23"
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0];

  // Get all players with active PP lines today
  const activePlayers = await db
    .select({ playerId: ppLinesTable.playerId, sport: playersTable.sport })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  // Deduplicate by playerId
  const uniquePlayers = [
    ...new Map(activePlayers.map(p => [p.playerId, p])).values(),
  ].filter(p => p.playerId !== null);

  let computed = 0;

  for (const { playerId, sport } of uniquePlayers) {
    try {
      // Only compute fatigue for sports with schedule data
      if (!["NBA", "WNBA", "NHL", "MLB", "NFL"].includes(sport)) continue;

      // Fetch this player's recent game logs (already in DB from projection sync)
      const logs = await db
        .select()
        .from(playerGameLogsTable)
        .where(
          and(
            eq(playerGameLogsTable.playerId, playerId!),
            gte(playerGameLogsTable.gameDate, sevenDaysAgo),
            eq(playerGameLogsTable.statType, sport === "MLB" ? "Hits" : "Points"),
            // Use "Points" for NBA/WNBA/NHL, "Hits" for MLB — just need dates/minutes
          )
        )
        .orderBy(desc(playerGameLogsTable.gameDate))
        .limit(10);

      if (!logs.length) {
        // No recent games — off season or new player
        // Still write a record so the page doesn't show demo data
        await db.insert(fatigueDataTable).values({
          playerId:        playerId!,
          computedForDate: today,
          daysRest:        null,
          isBackToBack:    false,
          isThreeInFour:   false,
          gamesLast7Days:  0,
          fatigueScore:    0,
          fatigueLabel:    "No recent games — off season or inactive",
          warnings:        "",
        }).onConflictDoUpdate({
          target: [fatigueDataTable.playerId, fatigueDataTable.computedForDate],
          set: { fatigueScore: 0, fatigueLabel: "No recent games", computedAt: new Date() },
        });
        continue;
      }

      const mostRecentLog = logs[0];
      const lastGameDate  = mostRecentLog.gameDate;   // "2026-05-22"
      const daysRest      = daysBetween(lastGameDate, today);
      const isBackToBack  = daysRest <= 1;

      // Three-in-four: check if player has 3+ games in the last 4 days
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
        .toISOString().split("T")[0];
      const recentLogs = logs.filter(l => l.gameDate >= fourDaysAgo);
      const isThreeInFour = recentLogs.length >= 3;

      // Previous game minutes
      const prevGameMinutes = parseFloat(mostRecentLog.minutes?.toString() ?? "0");

      // Average minutes over last 5 games
      const minutesL5 = logs.slice(0, 5)
        .map(l => parseFloat(l.minutes?.toString() ?? "0"))
        .filter(m => m > 0);
      const avgMinutesL5 = minutesL5.length
        ? minutesL5.reduce((a, b) => a + b, 0) / minutesL5.length
        : 0;

      // Travel distance (if player was away last game, coming home is travel)
      let travelMiles = 0;
      let timezoneShift = 0;

      const prevHomeAway = mostRecentLog.homeAway;
      const playerTeam = await db
        .select({ abbreviation: teamsTable.abbreviation })
        .from(teamsTable)
        .innerJoin(playersTable, eq(playersTable.teamId, teamsTable.id))
        .where(eq(playersTable.id, playerId!))
        .limit(1);

      const teamAbbr = playerTeam[0]?.abbreviation?.toUpperCase() ?? "";
      const homeCoords = ARENA_COORDS[teamAbbr];

      if (homeCoords && prevHomeAway === "away" && mostRecentLog.opponentTeamId) {
        // Player was away — get opponent arena to calculate travel back
        const oppTeam = await db
          .select({ abbreviation: teamsTable.abbreviation })
          .from(teamsTable)
          .where(eq(teamsTable.id, mostRecentLog.opponentTeamId))
          .limit(1);
        const oppAbbr = oppTeam[0]?.abbreviation?.toUpperCase() ?? "";
        const oppCoords = ARENA_COORDS[oppAbbr];

        if (oppCoords) {
          travelMiles = Math.round(
            haversineDistanceMiles(oppCoords.lat, oppCoords.lon, homeCoords.lat, homeCoords.lon)
          );
          timezoneShift = timezoneOffsetHours(oppCoords.tz, homeCoords.tz);
        }
      }

      // Compute fatigue score
      const { score, label, warnings } = computeFatigueScore({
        daysRest,
        isBackToBack,
        isThreeInFour,
        gamesLast7:     logs.length,
        prevGameMinutes,
        travelMiles,
        timezoneShift,
      });

      // Upsert to fatigue_data
      await db.insert(fatigueDataTable).values({
        playerId:            playerId!,
        computedForDate:     today,
        lastGameDate,
        daysRest,
        isBackToBack,
        isThreeInFour,
        gamesLast7Days:      logs.length,
        prevGameMinutes:     prevGameMinutes.toString(),
        avgMinutesL5:        avgMinutesL5.toFixed(1),
        prevGameHomeAway:    prevHomeAway ?? null,
        travelMiles,
        timezoneShiftHours:  timezoneShift,
        fatigueScore:        score,
        fatigueLabel:        label,
        warnings:            warnings.join(","),
        computedAt:          new Date(),
      }).onConflictDoUpdate({
        target: [fatigueDataTable.playerId, fatigueDataTable.computedForDate],
        set: {
          daysRest, isBackToBack, isThreeInFour,
          gamesLast7Days: logs.length,
          prevGameMinutes: prevGameMinutes.toString(),
          avgMinutesL5: avgMinutesL5.toFixed(1),
          travelMiles, timezoneShiftHours: timezoneShift,
          fatigueScore: score, fatigueLabel: label,
          warnings: warnings.join(","), computedAt: new Date(),
        },
      });

      computed++;
    } catch (err) {
      logger.error({ err, playerId }, "Fatigue compute error");
    }
  }

  logger.info({ computed }, "Fatigue data synced");
  return computed;
}
```

---

## STEP 4 — Wire Into Sync Routes and Cron

**File:** `artifacts/api-server/src/routes/sync.ts`

```typescript
import { syncFatigueData } from "../lib/sync/fatigue";

// Add to SYNC_JOBS array (alongside pp-lines, external-odds, projections):
{ name: "fatigue", provider: "internal", fn: syncFatigueData },

// Add individual route:
router.post("/sync/fatigue", async (req, res) => {
  await runSync("internal", "fatigue", syncFatigueData, res);
});
```

**File:** `artifacts/api-server/src/lib/cron.ts`

```typescript
import { syncFatigueData } from "./sync/fatigue";

// Run after projections sync at 6:30 AM (projections populate player_game_logs first)
cron.schedule("30 6 * * *", () =>
  logPull("internal", "fatigue", syncFatigueData)
);

// Also re-run at noon to catch any late injury/lineup news affecting minutes
cron.schedule("0 12 * * *", () =>
  logPull("internal", "fatigue", syncFatigueData)
);
```

**Also add to startup warm-up in `index.ts`:**
```typescript
import { syncFatigueData } from "./lib/sync/fatigue";

// Add after computeAllProjections() — runs projections first (needed for game logs),
// then fatigue uses those logs
setTimeout(async () => {
  await computeAllProjections();
  await syncFatigueData();   // ← ADD THIS
}, 2000);
```

---

## STEP 5 — Backend Route

**File:** `artifacts/api-server/src/routes/fatigue.ts` (NEW FILE)

```typescript
import { Router } from "express";
import { db } from "@workspace/db";
import {
  fatigueDataTable, playersTable, ppLinesTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// Today's fatigue data for all players on the active slate
router.get("/fatigue/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const { sport } = req.query as Record<string, string>;

    const rows = await db
      .select({
        playerId:           fatigueDataTable.playerId,
        playerName:         playersTable.fullName,
        sport:              playersTable.sport,
        team:               playersTable.teamId,
        fatigueScore:       fatigueDataTable.fatigueScore,
        fatigueLabel:       fatigueDataTable.fatigueLabel,
        daysRest:           fatigueDataTable.daysRest,
        isBackToBack:       fatigueDataTable.isBackToBack,
        isThreeInFour:      fatigueDataTable.isThreeInFour,
        gamesLast7Days:     fatigueDataTable.gamesLast7Days,
        prevGameMinutes:    fatigueDataTable.prevGameMinutes,
        avgMinutesL5:       fatigueDataTable.avgMinutesL5,
        travelMiles:        fatigueDataTable.travelMiles,
        timezoneShiftHours: fatigueDataTable.timezoneShiftHours,
        prevGameHomeAway:   fatigueDataTable.prevGameHomeAway,
        warnings:           fatigueDataTable.warnings,
        computedAt:         fatigueDataTable.computedAt,
      })
      .from(fatigueDataTable)
      .innerJoin(playersTable, eq(fatigueDataTable.playerId, playersTable.id))
      .where(
        and(
          eq(fatigueDataTable.computedForDate, today),
          sport ? eq(playersTable.sport, sport.toUpperCase()) : undefined,
        )
      )
      .orderBy(desc(fatigueDataTable.fatigueScore));

    // Only return players who have active PP lines today
    const activePlayerIds = new Set(
      (await db
        .select({ pid: ppLinesTable.playerId })
        .from(ppLinesTable)
        .where(eq(ppLinesTable.isActive, true))
      ).map(r => r.pid)
    );

    const filtered = rows.filter(r => activePlayerIds.has(r.playerId));

    res.json({
      date: today,
      players: filtered,
      computedAt: filtered[0]?.computedAt ?? null,
      summary: {
        total:           filtered.length,
        backToBack:      filtered.filter(r => r.isBackToBack).length,
        threeInFour:     filtered.filter(r => r.isThreeInFour).length,
        heavyFatigue:    filtered.filter(r => (r.fatigueScore ?? 0) >= 60).length,
        wellRested:      filtered.filter(r => (r.daysRest ?? 99) >= 4).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Fatigue for a specific player
router.get("/fatigue/player/:playerId", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(fatigueDataTable)
      .where(eq(fatigueDataTable.playerId, Number(req.params.playerId)))
      .orderBy(desc(fatigueDataTable.computedForDate))
      .limit(30);

    res.json(rows);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
```

**Register in `routes/index.ts`:**
```typescript
import fatigueRouter from "./fatigue";
app.use("/api", fatigueRouter);
```

---

## STEP 6 — Fix the Frontend — Remove Demo Data

**File:** (wherever the Fatigue Tracker page lives — find it by searching for the demo player names)

```bash
# Find the file with demo data:
grep -rn "demo\|Demo\|fake\|placeholder\|LeBron\|Giannis\|example" \
  artifacts/prizepicks/src/ --include="*.tsx" | grep -v ".js.map"
```

Once found, replace the demo data pattern with a real API call:

```tsx
// REMOVE anything like this:
const DEMO_FATIGUE = [
  { playerName: "LeBron James", fatigueScore: 72, ... },
  { playerName: "Stephen Curry", fatigueScore: 45, ... },
  // ...
];

// REPLACE with:
import { useQuery } from "@tanstack/react-query";

const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

function useFatigueData(sport?: string) {
  return useQuery({
    queryKey: ["/api/fatigue/today", sport],
    queryFn: async () => {
      const url = sport
        ? `${base}/api/fatigue/today?sport=${sport}`
        : `${base}/api/fatigue/today`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Fatigue fetch failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,  // 5 min cache
    refetchOnWindowFocus: false,
  });
}

// In the component:
const { data, isLoading } = useFatigueData(selectedSport);
const players = data?.players ?? [];

// Replace demo data usage with real data:
{isLoading ? (
  <LoadingSkeleton />
) : players.length === 0 ? (
  <EmptyFatigueState />   // See below
) : (
  players.map(player => <FatiguePlayerRow key={player.playerId} player={player} />)
)}
```

**Empty state when no data (NOT demo data):**

```tsx
function EmptyFatigueState() {
  return (
    <div className="py-16 text-center space-y-3">
      <Battery className="w-10 h-10 text-muted-foreground/30 mx-auto" />
      <div>
        <p className="text-sm font-mono font-semibold text-foreground">
          No fatigue data for today's slate
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Fatigue data computes from player game logs. Run Force Sync to
          pull today's schedule data and calculate rest scores.
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => fetch(`${base}/api/sync/fatigue`, { method: "POST" })}
        className="font-mono text-xs gap-1.5"
      >
        <RefreshCw className="w-3 h-3" /> Compute Fatigue Now
      </Button>
      <p className="text-[10px] text-slate-600 font-mono">
        Requires projection sync to have run first (populates game logs)
      </p>
    </div>
  );
}
```

---

## STEP 7 — Fatigue Player Row Component

The UI each player card should show:

```tsx
function FatiguePlayerRow({ player }: { player: FatigueData & { playerName: string; sport: string } }) {
  const score = player.fatigueScore ?? 0;
  const warnings = (player.warnings ?? "").split(",").filter(Boolean);

  const scoreColor =
    score >= 60 ? "text-rose-400" :
    score >= 40 ? "text-amber-400" :
    score <= -5 ? "text-emerald-400" :
    "text-slate-300";

  const barColor =
    score >= 60 ? "bg-rose-500" :
    score >= 40 ? "bg-amber-500" :
    "bg-emerald-500";

  return (
    <div className="flex items-center gap-4 p-3 bg-slate-900 border border-slate-800 rounded-lg">
      {/* Player name + sport */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{player.playerName}</div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {player.sport}
          {player.isBackToBack && (
            <span className="ml-2 text-rose-400 font-bold">B2B</span>
          )}
          {player.isThreeInFour && (
            <span className="ml-2 text-amber-400 font-bold">3in4</span>
          )}
        </div>
      </div>

      {/* Rest info */}
      <div className="text-center shrink-0">
        <div className="text-xs font-mono text-foreground font-bold">
          {player.daysRest === null ? "—"
            : player.daysRest === 0 ? "B2B"
            : player.daysRest === 1 ? "1 day"
            : `${player.daysRest} days`}
        </div>
        <div className="text-[10px] text-muted-foreground">rest</div>
      </div>

      {/* Minutes */}
      {player.prevGameMinutes && (
        <div className="text-center shrink-0">
          <div className="text-xs font-mono text-foreground font-bold">
            {parseFloat(player.prevGameMinutes.toString()).toFixed(0)}m
          </div>
          <div className="text-[10px] text-muted-foreground">last game</div>
        </div>
      )}

      {/* Travel */}
      {(player.travelMiles ?? 0) > 500 && (
        <div className="text-center shrink-0">
          <div className="text-xs font-mono text-amber-400 font-bold">
            {player.travelMiles?.toLocaleString()}mi
          </div>
          <div className="text-[10px] text-muted-foreground">travel</div>
        </div>
      )}

      {/* Fatigue score + bar */}
      <div className="shrink-0 w-24 space-y-1">
        <div className="flex justify-between text-[10px] font-mono">
          <span className="text-muted-foreground">Fatigue</span>
          <span className={`font-bold ${scoreColor}`}>{score}</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.abs(score)}%` }}
          />
        </div>
        <div className={`text-[9px] font-mono ${scoreColor} truncate`}>
          {player.fatigueLabel}
        </div>
      </div>
    </div>
  );
}
```

---

## IMPLEMENTATION ORDER

```
1. Create fatigue_data table (schema file + SQL migration)
2. Export from schema/index.ts
3. Create artifacts/api-server/src/lib/sync/fatigue.ts
4. Add syncFatigueData() to sync routes (/sync/fatigue + /sync/all)
5. Add to cron (6:30 AM + noon)
6. Add to startup warm-up in index.ts (runs after projections)
7. Create artifacts/api-server/src/routes/fatigue.ts
8. Register route in routes/index.ts
9. Find the demo data in the frontend Fatigue Tracker page
10. Remove demo data — replace with useFatigueData() hook
11. Add proper empty state instead of demo fallback
```

---

## ACCEPTANCE TEST

```
[ ] Run Force Sync → check /api/fatigue/today returns real player data
    Response should include players from today's active PP slate

[ ] Back-to-back detection works:
    Find a player whose team played yesterday — daysRest should be 1,
    isBackToBack should be true, fatigueScore should be 35+

[ ] Well rested detection works:
    Find a player whose team last played 4+ days ago — fatigueScore
    should be negative or near 0

[ ] Fatigue Tracker page shows REAL player names from today's slate
    NOT hardcoded demo players

[ ] Empty state (not demo data) shows when:
    - No active PP lines exist (before sync)
    - No game logs exist for today's players

[ ] After Force Sync, clicking "Compute Fatigue Now" in empty state
    triggers the sync and players appear within 10 seconds

[ ] fatigueScore flows into market-intel edge scoring when
    Variance Intelligence is enabled in Settings
```

---

## IMPORTANT NOTE ON DATA FRESHNESS

`syncFatigueData()` reads from `player_game_logs` which is populated by the
projection engine. **The projection sync must run BEFORE fatigue sync.**

If `player_game_logs` is empty (projection sync never ran or player ID mappings
don't exist), fatigue will return 0 records. Fix projection sync first if that
is also showing no data.

Check if game logs exist:
```sql
SELECT COUNT(*), MAX(game_date) FROM player_game_logs;
```

If count is 0, run `buildAllPlayerIdMappings()` first (via `/api/sync/projections`),
then re-run fatigue sync.

