/**
 * Seeds player_game_logs with realistic per-player historical game stats.
 * Run with: pnpm --filter @workspace/scripts run seed-game-logs
 *
 * Generates 12 games per player × stat type so the projection engine
 * has enough sample size to produce meaningful distributions.
 */
import { db } from "@workspace/db";
import { playerGameLogsTable, playersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

// Days ago helper
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
};

// [mean, std] → realistic game values (normal-ish, floor 0)
function genGames(mean: number, std: number, n: number): number[] {
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random(), u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    vals.push(Math.max(0, Math.round((mean + z * std) * 2) / 2));
  }
  return vals;
}

// Player game log definitions — realistic NBA star stats
// Format: { name, logs: { statType: [mean, std] } }
const PLAYER_LOGS: Array<{
  name: string;
  logs: Record<string, [number, number]>;
}> = [
  {
    name: "Jayson Tatum",
    logs: {
      Points:   [27.8, 6.2],
      Rebounds: [8.9,  2.8],
      Assists:  [4.8,  1.9],
    },
  },
  {
    name: "Jaylen Brown",
    logs: {
      Points:   [23.1, 5.4],
      Rebounds: [5.2,  2.1],
    },
  },
  {
    name: "Stephen Curry",
    logs: {
      Points:      [27.3, 7.1],
      "3-PT Made": [4.8,  1.8],
    },
  },
  {
    name: "LeBron James",
    logs: {
      Points:  [24.0, 5.8],
      Assists: [7.9,  2.4],
    },
  },
  {
    name: "Kevin Durant",
    logs: {
      Points: [26.7, 5.1],
    },
  },
  {
    name: "Devin Booker",
    logs: {
      Points: [25.0, 6.3],
    },
  },
  {
    name: "Nikola Jokic",
    logs: {
      Points:   [30.8, 7.2],
      Rebounds: [13.4, 3.1],
      Assists:  [9.2,  2.7],
    },
  },
  {
    name: "Jamal Murray",
    logs: {
      Points: [22.8, 6.9],
    },
  },
  {
    name: "Jimmy Butler",
    // Questionable status — fewer games, more variance
    logs: {
      Points: [19.4, 6.8],
    },
  },
  {
    name: "Giannis Antetokounmpo",
    logs: {
      Points:   [31.5, 7.8],
      Rebounds: [12.1, 3.4],
    },
  },
  {
    name: "Donovan Mitchell",
    logs: {
      Points: [27.2, 6.5],
    },
  },
];

// Number of historical game entries per player
const GAMES_PER_PLAYER = 14;

async function seedGameLogs() {
  console.log("Seeding player_game_logs…");

  // Clear existing log data
  await db.execute(sql`TRUNCATE TABLE player_game_logs RESTART IDENTITY`);

  const players = await db.select().from(playersTable);
  const playersByName = Object.fromEntries(players.map(p => [p.fullName, p]));

  let total = 0;

  for (const def of PLAYER_LOGS) {
    const player = playersByName[def.name];
    if (!player) {
      console.warn(`  ⚠ Player not found: ${def.name}`);
      continue;
    }

    for (const [statType, [mean, std]] of Object.entries(def.logs)) {
      const values = genGames(mean, std, GAMES_PER_PLAYER);
      const rows = values.map((value, i) => ({
        playerId: player.id,
        gameDate: daysAgo(i + 1),
        statType,
        value: value.toString(),
        source: "seed" as const,
      }));

      await db.insert(playerGameLogsTable).values(rows).onConflictDoNothing();
      console.log(`  ${def.name} | ${statType} | ${values.length} games | avg=${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}`);
      total += rows.length;
    }
  }

  console.log(`\nSeeded ${total} game log rows across ${PLAYER_LOGS.length} players.`);
  process.exit(0);
}

seedGameLogs().catch(e => { console.error(e); process.exit(1); });
