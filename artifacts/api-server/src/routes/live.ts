import { Router } from "express";
import { db } from "@workspace/db";
import {
  entriesTable, entryPicksTable, playersTable, gamesTable, teamsTable,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

const ODDS_BASE = process.env.ODDS_API_BASE ?? "https://api.the-odds-api.com/v4";
const ODDS_KEY  = process.env.ODDS_API_KEY ?? "";

const SPORT_KEYS: Record<string, string> = {
  NBA:   "basketball_nba",
  WNBA:  "basketball_wnba",
  MLB:   "baseball_mlb",
  NFL:   "americanfootball_nfl",
  NHL:   "icehockey_nhl",
  NCAAF: "americanfootball_ncaaf",
  NCAAB: "basketball_ncaab",
};

type OddsScore = {
  id:             string;
  sport_key:      string;
  home_team:      string;
  away_team:      string;
  commence_time:  string;
  completed:      boolean;
  scores:         { name: string; score: string }[] | null;
  last_update:    string | null;
};

const scoreCache = new Map<string, { data: OddsScore[]; at: number }>();
const CACHE_TTL_MS = 45_000;

async function fetchSportScores(sportKey: string): Promise<OddsScore[]> {
  const cached = scoreCache.get(sportKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  if (!ODDS_KEY) return [];
  try {
    const url = `${ODDS_BASE}/sports/${sportKey}/scores?apiKey=${ODDS_KEY}&daysFrom=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return scoreCache.get(sportKey)?.data ?? [];
    const data: OddsScore[] = await res.json() as OddsScore[];
    scoreCache.set(sportKey, { data, at: Date.now() });
    return data;
  } catch {
    return scoreCache.get(sportKey)?.data ?? [];
  }
}

// GET /api/live/scores
// Returns raw Odds API score data for all sports with games today (cached 45s).
router.get("/live/scores", async (_req, res) => {
  const today = new Date().toISOString().split("T")[0]!;
  const results = await Promise.all(Object.values(SPORT_KEYS).map(k => fetchSportScores(k)));
  const all = results.flat().filter(g => g.commence_time.startsWith(today));
  return void res.json({ games: all });
});

// GET /api/live/entries
// Returns today's pending entries with per-leg game context pulled from Odds API scores.
router.get("/live/entries", async (_req, res) => {
  const today = new Date().toISOString().split("T")[0]!;

  const entries = await db
    .select()
    .from(entriesTable)
    .where(and(eq(entriesTable.result, "pending"), eq(entriesTable.entryDate, today)));

  if (entries.length === 0) return void res.json({ entries: [], hasAnyLive: false });

  const entryIds = entries.map(e => e.id);

  const picks = await db
    .select({ pick: entryPicksTable, player: playersTable })
    .from(entryPicksTable)
    .leftJoin(playersTable, eq(entryPicksTable.playerId, playersTable.id))
    .where(inArray(entryPicksTable.entryId, entryIds));

  const gameIds = [...new Set(picks.filter(p => p.pick.gameId != null).map(p => p.pick.gameId as number))];

  const gameRows = gameIds.length > 0
    ? await db
        .select({ game: gamesTable, homeTeam: teamsTable })
        .from(gamesTable)
        .leftJoin(teamsTable, eq(gamesTable.homeTeamId, teamsTable.id))
        .where(inArray(gamesTable.id, gameIds))
    : [];

  const awayTeamIds = [...new Set(gameRows.map(r => r.game.awayTeamId))];
  const awayTeamRows = awayTeamIds.length > 0
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, awayTeamIds))
    : [];
  const awayTeamMap = new Map(awayTeamRows.map(t => [t.id, t]));

  const sports = [...new Set(gameRows.map(r => r.game.sport.toUpperCase()))];
  const sportKeyEntries = sports.map(s => [s, SPORT_KEYS[s]] as [string, string]).filter(([, k]) => k != null);
  const oddsScores = (await Promise.all(sportKeyEntries.map(([, k]) => fetchSportScores(k)))).flat();

  function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

  const gameScoreMap = new Map<number, OddsScore>();
  for (const { game, homeTeam } of gameRows) {
    if (!homeTeam) continue;
    const awayTeam = awayTeamMap.get(game.awayTeamId);
    if (!awayTeam) continue;
    const hAbbr = normalize(homeTeam.abbreviation ?? "");
    const aAbbr = normalize(awayTeam.abbreviation ?? "");
    const hFull = normalize(homeTeam.name);
    const aFull = normalize(awayTeam.name);
    const match = oddsScores.find(os => {
      const oh = normalize(os.home_team);
      const oa = normalize(os.away_team);
      return (oh.includes(hAbbr) || hFull.includes(oh.slice(0, 4))) &&
             (oa.includes(aAbbr) || aFull.includes(oa.slice(0, 4)));
    });
    if (match) gameScoreMap.set(game.id, match);
  }

  const picksByEntry = new Map<number, typeof picks>();
  for (const p of picks) {
    if (!picksByEntry.has(p.pick.entryId)) picksByEntry.set(p.pick.entryId, []);
    picksByEntry.get(p.pick.entryId)!.push(p);
  }

  let hasAnyLive = false;

  const result = entries.map(entry => {
    const entryPicks = picksByEntry.get(entry.id) ?? [];
    const legs = entryPicks.map(({ pick, player }) => {
      const oddsGame = pick.gameId ? gameScoreMap.get(pick.gameId) : null;
      const isLive    = oddsGame != null && !oddsGame.completed && (oddsGame.scores?.length ?? 0) > 0;
      const isFinal   = oddsGame?.completed ?? false;
      if (isLive) hasAnyLive = true;
      const homeScore = oddsGame?.scores?.find(s => s.name === oddsGame.home_team)?.score ?? null;
      const awayScore = oddsGame?.scores?.find(s => s.name === oddsGame.away_team)?.score ?? null;
      return {
        pickId:      pick.id,
        playerName:  pick.playerName ?? player?.fullName ?? "Unknown",
        statType:    pick.statType,
        lineValue:   Number(pick.lineValue),
        direction:   pick.direction,
        result:      pick.result,
        currentValue: null as null,
        isLive,
        isFinal,
        gameScore: oddsGame
          ? {
              homeTeam:     oddsGame.home_team,
              awayTeam:     oddsGame.away_team,
              homeScore,
              awayScore,
              commenceTime: oddsGame.commence_time,
              lastUpdate:   oddsGame.last_update,
            }
          : null,
      };
    });

    const hasLiveGame = legs.some(l => l.isLive);
    return {
      entryId:         entry.id,
      entryType:       entry.entryType,
      pickCount:       entry.pickCount,
      stake:           Number(entry.stake),
      potentialPayout: entry.potentialPayout != null ? Number(entry.potentialPayout) : null,
      hasLiveGame,
      legs,
    };
  });

  return void res.json({ entries: result, hasAnyLive });
});

export default router;
