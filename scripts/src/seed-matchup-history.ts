/**
 * Seeds matchup_history with realistic per-opponent averages.
 * Run after seed.ts so players and teams already exist.
 * pnpm --filter @workspace/scripts run seed-matchup-history
 */
import { db } from "@workspace/db";
import { matchupHistoryTable, playersTable, teamsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding matchup_history…");

  await db.execute(sql`TRUNCATE TABLE matchup_history RESTART IDENTITY`);

  const players = await db.select().from(playersTable);
  const teams   = await db.select().from(teamsTable);

  const byName = Object.fromEntries(players.map(p => [p.fullName, p]));
  const byAbbr = Object.fromEntries(teams.map(t => [t.abbreviation, t]));

  // Format: [playerName, opponentAbbr, statType, gamesPlayed, avgValue, overRateAtCurrentLine]
  // "overRateAtCurrentLine" = fraction of those games where value > current PP line
  const defs: [string, string, string, number, number, number][] = [
    // Tatum vs MIA — good matchup historically
    ["Jayson Tatum",            "MIA", "points",   12, 29.4, 0.67],
    ["Jayson Tatum",            "MIA", "rebounds",  12,  9.1, 0.58],
    ["Jayson Tatum",            "MIA", "assists",   12,  5.2, 0.67],
    // Brown vs MIA
    ["Jaylen Brown",            "MIA", "points",   10, 24.8, 0.60],
    // Butler vs BOS — tough matchup
    ["Jimmy Butler",            "BOS", "points",   10, 17.3, 0.30],
    // Jokic vs PHX — dominant
    ["Nikola Jokic",            "PHX", "points",   14, 33.1, 0.71],
    ["Nikola Jokic",            "PHX", "rebounds",  14, 14.8, 0.79],
    ["Nikola Jokic",            "PHX", "assists",   14,  9.8, 0.57],
    // Murray vs PHX
    ["Jamal Murray",            "PHX", "points",   12, 23.5, 0.58],
    // Durant vs DEN
    ["Kevin Durant",            "DEN", "points",   12, 28.2, 0.67],
    // Booker vs DEN — tough
    ["Devin Booker",            "DEN", "points",   12, 21.9, 0.42],
    // Giannis vs CLE
    ["Giannis Antetokounmpo",   "CLE", "points",   12, 33.8, 0.75],
    ["Giannis Antetokounmpo",   "CLE", "rebounds",  12, 13.0, 0.67],
    // Mitchell vs MIL
    ["Donovan Mitchell",        "MIL", "points",   12, 29.1, 0.67],
    // Curry vs LAL
    ["Stephen Curry",           "LAL", "points",   14, 30.1, 0.71],
    ["Stephen Curry",           "LAL", "threes_made", 14, 5.1, 0.71],
    // LeBron vs GSW
    ["LeBron James",            "GSW", "points",   12, 23.4, 0.50],
    ["LeBron James",            "GSW", "assists",   12,  8.2, 0.58],
  ];

  const rows = defs.map(([name, opp, stat, games, avg, overRate]) => ({
    playerId: byName[name]?.id,
    opponentTeamId: byAbbr[opp]?.id,
    statType: stat,
    gamesPlayed: games,
    avgValue: avg.toString(),
    overRateAtCurrentLine: overRate.toString(),
  })).filter(r => r.playerId && r.opponentTeamId) as Array<{
    playerId: number;
    opponentTeamId: number;
    statType: string;
    gamesPlayed: number;
    avgValue: string;
    overRateAtCurrentLine: string;
  }>;

  if (rows.length) {
    await db.insert(matchupHistoryTable).values(rows).onConflictDoNothing();
    console.log(`Inserted ${rows.length} matchup history records`);
  }

  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
