import { Router } from "express";
import { db } from "@workspace/db";
import {
  teamPaceRatingsTable, gamesTable, teamsTable, playerGameLogsTable, playersTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import {
  computeTeamPace, buildGamePaceResult, getPaceAdjustment, NBA_2025_SEED_PACE,
} from "../lib/analytics/pace";
import { logger } from "../lib/logger";

const router = Router();

const CURRENT_SEASON = "2025";

// ── Internal: compute pace from game logs for one team ───────────────────────
async function computePaceFromLogs(teamAbbr: string): Promise<{ pace: number; games: number } | null> {
  // Pivot: for each (player, game_date) collect FGA/FTA/OREB/TOV/minutes
  // Only works if box-score stats exist in game logs
  const result = await db.execute(sql`
    SELECT
      game_date,
      SUM(CASE WHEN stat_type = 'FieldGoalsAttempted'   THEN value::numeric ELSE 0 END) AS fga,
      SUM(CASE WHEN stat_type = 'FreeThrowsAttempted'   THEN value::numeric ELSE 0 END) AS fta,
      SUM(CASE WHEN stat_type = 'OffensiveRebounds'     THEN value::numeric ELSE 0 END) AS oreb,
      SUM(CASE WHEN stat_type = 'Turnovers'             THEN value::numeric ELSE 0 END) AS tov,
      SUM(CASE WHEN stat_type = 'Minutes'               THEN value::numeric ELSE 0 END) AS minutes
    FROM player_game_logs pgl
    JOIN players p ON p.id = pgl.player_id
    JOIN teams t ON t.id = p.team_id
    WHERE t.abbreviation = ${teamAbbr}
    GROUP BY game_date
    HAVING SUM(CASE WHEN stat_type = 'FieldGoalsAttempted' THEN 1 ELSE 0 END) > 0
    ORDER BY game_date DESC
    LIMIT 30
  `);

  const rows = result.rows as { fga: string; fta: string; oreb: string; tov: string; minutes: string }[];
  if (rows.length < 3) return null;

  const logs = rows.map(r => ({
    fga: Number(r.fga),
    fta: Number(r.fta),
    oreb: Number(r.oreb),
    tov: Number(r.tov),
    minutes: Number(r.minutes),
  }));

  return { pace: computeTeamPace(logs), games: logs.length };
}

// ── POST /admin/sync/pace ────────────────────────────────────────────────────
router.post("/admin/sync/pace", async (req, res) => {
  try {
    const teams = await db.select().from(teamsTable).where(eq(teamsTable.sport, "NBA"));
    let computed = 0;
    let seeded = 0;

    for (const team of teams) {
      const fromLogs = await computePaceFromLogs(team.abbreviation);
      const seedPace = NBA_2025_SEED_PACE[team.abbreviation] ?? 100.0;

      const paceRating = fromLogs ? String(Math.round(fromLogs.pace * 10) / 10) : String(seedPace);
      const gamesComputed = fromLogs?.games ?? 0;

      await db
        .insert(teamPaceRatingsTable)
        .values({
          teamName: team.name,
          teamAbbr: team.abbreviation,
          sport: "NBA",
          season: CURRENT_SEASON,
          paceRating,
          last10PaceRating: paceRating,
          homeAwayPaceAdj: "0",
          gamesComputed,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [teamPaceRatingsTable.teamAbbr, teamPaceRatingsTable.sport, teamPaceRatingsTable.season],
          set: { paceRating, last10PaceRating: paceRating, gamesComputed, computedAt: new Date() },
        });

      if (fromLogs) computed++; else seeded++;
    }

    logger.info({ computed, seeded }, "Team pace ratings synced");
    res.json({ status: "ok", computed, seeded, total: computed + seeded });
  } catch (err) {
    logger.error(err, "Pace sync failed");
    res.status(500).json({ error: "Pace sync failed" });
  }
});

// ── GET /pace/tonight ────────────────────────────────────────────────────────
router.get("/pace/tonight", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const games = await db
      .select()
      .from(gamesTable)
      .where(and(gte(gamesTable.startTime, todayStart), lte(gamesTable.startTime, todayEnd)));

    if (games.length === 0) return void res.json([]);

    const allTeamIds = [...new Set([...games.map(g => g.homeTeamId), ...games.map(g => g.awayTeamId)])];
    const teams = await db.select().from(teamsTable).where(inArray(teamsTable.id, allTeamIds));
    const teamMap = Object.fromEntries(teams.map(t => [t.id, t]));

    const teamAbbrs = teams.map(t => t.abbreviation);
    const paceRatings = teamAbbrs.length
      ? await db
          .select()
          .from(teamPaceRatingsTable)
          .where(
            and(
              inArray(teamPaceRatingsTable.teamAbbr, teamAbbrs),
              eq(teamPaceRatingsTable.season, CURRENT_SEASON),
            ),
          )
      : [];

    const paceMap = Object.fromEntries(paceRatings.map(p => [p.teamAbbr, Number(p.paceRating)]));

    const result = games.map(game => {
      const homeTeam = teamMap[game.homeTeamId];
      const awayTeam = teamMap[game.awayTeamId];
      const homeTeamPace = paceMap[homeTeam?.abbreviation ?? ""] ?? 100.0;
      const awayTeamPace = paceMap[awayTeam?.abbreviation ?? ""] ?? 100.0;
      const paceResult = buildGamePaceResult(homeTeamPace, awayTeamPace);

      return {
        gameId: game.id,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeTeam: homeTeam?.abbreviation ?? "?",
        homeTeamName: homeTeam?.name ?? "?",
        awayTeam: awayTeam?.abbreviation ?? "?",
        awayTeamName: awayTeam?.name ?? "?",
        sport: game.sport,
        startTime: game.startTime,
        homeTeamPace,
        awayTeamPace,
        ...paceResult,
      };
    });

    res.json(result);
  } catch (err) {
    logger.error(err, "Pace tonight fetch failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /pace/team/:abbr ─────────────────────────────────────────────────────
router.get("/pace/team/:abbr", async (req, res) => {
  try {
    const [rating] = await db
      .select()
      .from(teamPaceRatingsTable)
      .where(
        and(
          eq(teamPaceRatingsTable.teamAbbr, req.params.abbr.toUpperCase()),
          eq(teamPaceRatingsTable.season, CURRENT_SEASON),
        ),
      )
      .limit(1);

    if (!rating) return void res.status(404).json({ error: "No pace rating for this team" });
    res.json(rating);
  } catch (err) {
    logger.error(err, "Team pace fetch failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
