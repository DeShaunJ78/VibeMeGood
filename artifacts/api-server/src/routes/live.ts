import { Router } from "express";
import { db } from "@workspace/db";
import {
  entriesTable, entryPicksTable, playersTable, gamesTable, teamsTable,
  playerGameLogsTable,
} from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

// ── Odds API ──────────────────────────────────────────────────────────────────

const ODDS_BASE = process.env.ODDS_API_BASE ?? "https://api.the-odds-api.com/v4";
const ODDS_KEY  = process.env.ODDS_API_KEY ?? "";

const SPORT_KEYS: Record<string, string> = {
  NBA:   "basketball_nba",  WNBA:  "basketball_wnba",
  MLB:   "baseball_mlb",    NFL:   "americanfootball_nfl",
  NHL:   "icehockey_nhl",   NCAAF: "americanfootball_ncaaf",
  NCAAB: "basketball_ncaab",
};

type OddsScore = {
  id: string; sport_key: string; home_team: string; away_team: string;
  commence_time: string; completed: boolean;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
};

const oddsCache = new Map<string, { data: OddsScore[]; at: number }>();
const CACHE_TTL = 45_000;

async function fetchSportScores(sportKey: string): Promise<OddsScore[]> {
  const cached = oddsCache.get(sportKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
  if (!ODDS_KEY) return [];
  try {
    const url = `${ODDS_BASE}/sports/${sportKey}/scores?apiKey=${ODDS_KEY}&daysFrom=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return oddsCache.get(sportKey)?.data ?? [];
    const data = await res.json() as OddsScore[];
    oddsCache.set(sportKey, { data, at: Date.now() });
    return data;
  } catch {
    return oddsCache.get(sportKey)?.data ?? [];
  }
}

// ── ESPN live stats (free, unofficial API, no key required) ───────────────────
// Provides live box scores with player-level stats + game clock for pacing math.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_SPORT: Record<string, string> = {
  NBA: "basketball/nba",  WNBA: "basketball/wnba",
  MLB: "baseball/mlb",   NFL:  "football/nfl",
  NHL: "icehockey/nhl",  NCAAB: "basketball/ncaab",  NCAAF: "football/ncaaf",
};

type EspnEvent = {
  id: string;
  status: { type: { completed: boolean }; period: number; displayClock: string };
  competitions: {
    competitors: { team: { abbreviation: string; displayName: string }; homeAway: string }[];
  }[];
};

type EspnPlayerStat = {
  displayName: string;
  groupLabel: string; // e.g. "passing", "rushing", "receiving"
  statNames:  string[];
  statValues: string[];
};

type EspnGameData = {
  period: number;
  displayClock: string;
  completed: boolean;
  players: EspnPlayerStat[];
};

const espnBoardCache = new Map<string, { data: EspnEvent[]; at: number }>();
const espnGameCache  = new Map<string, { data: EspnGameData | null; at: number }>();

async function fetchEspnScoreboard(sportPath: string): Promise<EspnEvent[]> {
  const cached = espnBoardCache.get(sportPath);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
  try {
    const res = await fetch(`${ESPN_BASE}/${sportPath}/scoreboard`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return espnBoardCache.get(sportPath)?.data ?? [];
    const body = await res.json() as { events?: EspnEvent[] };
    const events = body?.events ?? [];
    espnBoardCache.set(sportPath, { data: events, at: Date.now() });
    return events;
  } catch {
    return espnBoardCache.get(sportPath)?.data ?? [];
  }
}

async function fetchEspnGameData(sportPath: string, eventId: string): Promise<EspnGameData | null> {
  const key = `${sportPath}:${eventId}`;
  const cached = espnGameCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
  try {
    const res = await fetch(`${ESPN_BASE}/${sportPath}/summary?event=${eventId}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { espnGameCache.set(key, { data: null, at: Date.now() }); return null; }
    const body = await res.json() as Record<string, unknown>;

    const comp = (body?.header as any)?.competitions?.[0];
    const period = comp?.status?.period ?? 0;
    const displayClock = comp?.status?.displayClock ?? "0:00";
    const completed = comp?.status?.type?.completed ?? false;

    // Flatten all athletes from all stat groups across both teams.
    const players: EspnPlayerStat[] = [];
    for (const teamGroup of ((body?.boxscore as any)?.players ?? [])) {
      for (const statGroup of (teamGroup?.statistics ?? [])) {
        const groupLabel: string = (statGroup?.type ?? statGroup?.label ?? "").toLowerCase();
        const names: string[] = statGroup?.names ?? [];
        for (const row of (statGroup?.athletes ?? [])) {
          players.push({
            displayName: row?.athlete?.displayName ?? "",
            groupLabel,
            statNames:  names,
            statValues: row?.stats ?? [],
          });
        }
      }
    }

    const data: EspnGameData = { period, displayClock, completed, players };
    espnGameCache.set(key, { data, at: Date.now() });
    return data;
  } catch {
    espnGameCache.set(key, { data: null, at: Date.now() });
    return null;
  }
}

// ── Game progress ─────────────────────────────────────────────────────────────

// Returns fraction of game elapsed (0–1). 0 if not started, 1 if fully complete.
function gameProgressFraction(sport: string, period: number, displayClock: string): number {
  if (period <= 0) return 0;
  const [mStr, sStr] = displayClock.split(":");
  const secsRemaining = (parseInt(mStr ?? "0", 10) * 60) + parseInt(sStr ?? "0", 10);
  const s = sport.toUpperCase();

  if (s === "NBA") {
    // 4 quarters × 12 min = 48 min
    const ps = 12 * 60;
    return Math.min((Math.min(period - 1, 4) * ps + Math.max(0, ps - secsRemaining)) / (4 * ps), 1.0);
  }
  if (s === "WNBA") {
    // 4 quarters × 10 min = 40 min
    const ps = 10 * 60;
    return Math.min((Math.min(period - 1, 4) * ps + Math.max(0, ps - secsRemaining)) / (4 * ps), 1.0);
  }
  if (s === "NCAAB") {
    // 2 halves × 20 min = 40 min (ESPN period 1 = first half, period 2 = second half)
    const ps = 20 * 60;
    return Math.min((Math.min(period - 1, 2) * ps + Math.max(0, ps - secsRemaining)) / (2 * ps), 1.0);
  }
  if (s === "NHL") {
    const ps = 20 * 60;
    return Math.min((Math.min(period - 1, 3) * ps + Math.max(0, ps - secsRemaining)) / (3 * ps), 1.0);
  }
  if (s === "NFL" || s === "NCAAF") {
    const ps = 15 * 60;
    return Math.min((Math.min(period - 1, 4) * ps + Math.max(0, ps - secsRemaining)) / (4 * ps), 1.0);
  }
  if (s === "MLB") {
    // Innings-based: period = inning number; 9 innings standard.
    return Math.min((period - 1) / 9, 1.0);
  }
  return 0;
}

// ── ESPN stat lookup ──────────────────────────────────────────────────────────

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// PP stat type (normalized) → ESPN column names to sum + optional group filter.
const ESPN_STAT_MAP: Record<string, { cols: string[]; group?: string }> = {
  // NBA / WNBA / NCAAB
  "points":                   { cols: ["PTS"] },
  "rebounds":                 { cols: ["REB"] },
  "assists":                  { cols: ["AST"] },
  "blocks":                   { cols: ["BLK"] },
  "steals":                   { cols: ["STL"] },
  "turnovers":                { cols: ["TO"] },
  "3pointersmade":            { cols: ["3PT"] },
  "3pointers":                { cols: ["3PT"] },
  "ptsasts":                  { cols: ["PTS", "AST"] },
  "ptsrebs":                  { cols: ["PTS", "REB"] },
  "rebsasts":                 { cols: ["REB", "AST"] },
  "ptsrebsasts":              { cols: ["PTS", "REB", "AST"] },
  "blksstls":                 { cols: ["BLK", "STL"] },
  "pointsreboundsassists":    { cols: ["PTS", "REB", "AST"] },
  "pointsrebounds":           { cols: ["PTS", "REB"] },
  "pointsassists":            { cols: ["PTS", "AST"] },
  "reboundsassists":          { cols: ["REB", "AST"] },
  "blockssteals":             { cols: ["BLK", "STL"] },
  // NHL
  "goals":                    { cols: ["G"] },
  "goal":                     { cols: ["G"] },
  "shotsongoal":              { cols: ["SOG"] },
  "shots":                    { cols: ["SOG"] },
  "saves":                    { cols: ["SV"] },
  "hits":                     { cols: ["HT"] },
  // MLB
  "strikeouts":               { cols: ["SO"] },
  "runs":                     { cols: ["R"] },
  "rbis":                     { cols: ["RBI"] },
  "homeruns":                 { cols: ["HR"] },
  "walks":                    { cols: ["BB"] },
  // NFL — groupHint disambiguates YDS across passing/rushing/receiving groups
  "passingyards":             { cols: ["YDS"], group: "passing" },
  "rushingyards":             { cols: ["YDS"], group: "rushing" },
  "receivingyards":           { cols: ["YDS"], group: "receiving" },
  "receptions":               { cols: ["REC"] },
  "completions":              { cols: ["CMP"] },
  "touchdowns":               { cols: ["TD"] },
  "interceptions":            { cols: ["INT"] },
  "sacks":                    { cols: ["SACKS"] },
};

function parseEspnVal(raw: string): number {
  if (!raw || raw === "--" || raw === "-") return 0;
  if (raw.includes(":")) return NaN;           // time format (MIN, TOI) — not a countable stat
  return parseFloat(raw.split("-")[0]!);        // "3-4" (made-att) → 3; "25" → 25
}

// Returns the player's current stat from ESPN box score data, or null if not found.
function getPlayerStat(playerName: string, statType: string, players: EspnPlayerStat[]): number | null {
  const mapping = ESPN_STAT_MAP[normKey(statType)];
  if (!mapping) return null;
  const { cols, group } = mapping;

  const nameLower = playerName.toLowerCase();
  const nameParts = nameLower.split(" ");
  const lastName  = nameParts[nameParts.length - 1]!;

  // Collect best value per stat column (handle player appearing in multiple groups)
  const found = new Map<string, number>();

  for (const row of players) {
    const espnLower = row.displayName.toLowerCase();
    if (!espnLower.includes(lastName)) continue;                // last-name guard
    if (group && !row.groupLabel.includes(group)) continue;      // group filter (NFL)

    for (const col of cols) {
      const idx = row.statNames.indexOf(col);
      if (idx < 0) continue;
      const val = parseEspnVal(row.statValues[idx] ?? "");
      if (isNaN(val)) continue;
      const existing = found.get(col) ?? -Infinity;
      if (val > existing) found.set(col, val);
    }
  }

  if (found.size === 0) return null;
  return [...found.values()].reduce((a, b) => a + b, 0);
}

// ── Pacing classification ─────────────────────────────────────────────────────

type PacingStatus = "pre_game" | "live" | "on_pace" | "behind" | "final";

function classifyPacing(
  isLive: boolean,
  isFinal: boolean,
  currentValue: number | null,
  lineValue: number,
  direction: string,
  progressFraction: number,
): PacingStatus {
  if (!isLive && !isFinal) return "pre_game";

  if (currentValue != null) {
    // Helper: did this player hit/beat the line for this direction?
    const hit = direction === "less"
      ? currentValue <= lineValue
      : currentValue >= lineValue;

    if (isFinal) return hit ? "on_pace" : "behind";

    // Live game: linear extrapolation only when enough game has elapsed (>10%)
    // to avoid wild early-game projections. Below the threshold, show "live".
    if (isLive && progressFraction > 0.10) {
      const projected = currentValue / progressFraction;
      const onPace = direction === "less" ? projected <= lineValue : projected >= lineValue;
      return onPace ? "on_pace" : "behind";
    }
  }

  return isFinal ? "final" : "live";
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/live/scores
router.get("/live/scores", async (_req, res) => {
  const today = new Date().toISOString().split("T")[0]!;
  const results = await Promise.all(Object.values(SPORT_KEYS).map(k => fetchSportScores(k)));
  const all = results.flat().filter(g => g.commence_time.startsWith(today));
  return void res.json({ games: all });
});

// GET /api/live/entries
// Returns today's pending entries with per-leg pacing (ON_PACE / BEHIND / LIVE / PRE_GAME / FINAL).
// currentValue is sourced from: player_game_logs (completed games) or ESPN live box score (live games).
// progressFraction from ESPN game clock drives linear-extrapolation pacing during live games.
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

  // Batch-load today's game logs → populates currentValue for completed games.
  const playerIds = [...new Set(picks.map(p => p.pick.playerId).filter((id): id is number => id != null))];
  const gameLogs = playerIds.length > 0
    ? await db
        .select({ playerId: playerGameLogsTable.playerId, statType: playerGameLogsTable.statType, value: playerGameLogsTable.value })
        .from(playerGameLogsTable)
        .where(and(inArray(playerGameLogsTable.playerId, playerIds), eq(playerGameLogsTable.gameDate, today)))
    : [];
  const logMap = new Map<string, number>();
  for (const log of gameLogs) {
    logMap.set(`${log.playerId}:${log.statType.toLowerCase()}`, parseFloat(log.value));
  }

  // Load game metadata from DB.
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
  const gameDbMap   = new Map(gameRows.map(r => [r.game.id, r]));

  // Fetch Odds API scores for each sport involved.
  const sports = [...new Set(gameRows.map(r => r.game.sport.toUpperCase()))];
  const sportKeyPairs = sports.map(s => [s, SPORT_KEYS[s]] as [string, string]).filter(([, k]) => k != null);
  const oddsScores = (await Promise.all(sportKeyPairs.map(([, k]) => fetchSportScores(k)))).flat();

  function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

  // Match DB games to Odds API game scores by team abbreviation/name.
  const gameScoreMap = new Map<number, OddsScore>();
  for (const { game, homeTeam } of gameRows) {
    if (!homeTeam) continue;
    const awayTeam = awayTeamMap.get(game.awayTeamId);
    if (!awayTeam) continue;
    const hAbbr = norm(homeTeam.abbreviation ?? "");
    const aAbbr = norm(awayTeam.abbreviation ?? "");
    const hFull = norm(homeTeam.name);
    const aFull = norm(awayTeam.name);
    const match = oddsScores.find(os => {
      const oh = norm(os.home_team);
      const oa = norm(os.away_team);
      return (oh.includes(hAbbr) || hFull.includes(oh.slice(0, 4))) &&
             (oa.includes(aAbbr) || aFull.includes(oa.slice(0, 4)));
    });
    if (match) gameScoreMap.set(game.id, match);
  }

  // For live games: fetch ESPN scoreboard → match event IDs → fetch game summaries (box scores).
  // espnDataMap key: "normHome:normAway" → EspnGameData
  const espnDataMap = new Map<string, EspnGameData>();

  const liveOddsGames = [...gameScoreMap.values()].filter(g => !g.completed && (g.scores?.length ?? 0) > 0);
  if (liveOddsGames.length > 0) {
    const sportKeyToAbbrev = Object.fromEntries(Object.entries(SPORT_KEYS).map(([k, v]) => [v, k]));

    // Group live games by sport_key, then batch ESPN fetches per sport.
    const liveBySport = new Map<string, OddsScore[]>();
    for (const g of liveOddsGames) {
      if (!liveBySport.has(g.sport_key)) liveBySport.set(g.sport_key, []);
      liveBySport.get(g.sport_key)!.push(g);
    }

    await Promise.all([...liveBySport.entries()].map(async ([sportKey, oddsGames]) => {
      const abbrev = sportKeyToAbbrev[sportKey];
      const espnPath = abbrev ? ESPN_SPORT[abbrev] : undefined;
      if (!espnPath) return;

      const espnEvents = await fetchEspnScoreboard(espnPath);

      await Promise.all(oddsGames.map(async oddsGame => {
        const oh = norm(oddsGame.home_team);
        const oa = norm(oddsGame.away_team);

        const espnEvent = espnEvents.find(ev => {
          const comps = ev.competitions[0]?.competitors ?? [];
          const home = comps.find(c => c.homeAway === "home");
          const away = comps.find(c => c.homeAway === "away");
          if (!home || !away) return false;
          const eh = norm(home.team.displayName);
          const ea = norm(away.team.displayName);
          return (eh.includes(oh.slice(0, 5)) || oh.includes(eh.slice(0, 5))) &&
                 (ea.includes(oa.slice(0, 5)) || oa.includes(ea.slice(0, 5)));
        });

        if (!espnEvent) return;
        const data = await fetchEspnGameData(espnPath, espnEvent.id);
        if (data) espnDataMap.set(`${oh}:${oa}`, data);
      }));
    }));
  }

  // Build legs.
  const picksByEntry = new Map<number, typeof picks>();
  for (const p of picks) {
    if (!picksByEntry.has(p.pick.entryId)) picksByEntry.set(p.pick.entryId, []);
    picksByEntry.get(p.pick.entryId)!.push(p);
  }

  let hasAnyLive = false;

  const result = entries.map(entry => {
    const entryPicks = picksByEntry.get(entry.id) ?? [];
    const legs = entryPicks.map(({ pick, player }) => {
      const oddsGame   = pick.gameId ? gameScoreMap.get(pick.gameId) : null;
      const isLive     = oddsGame != null && !oddsGame.completed && (oddsGame.scores?.length ?? 0) > 0;
      const isFinal    = oddsGame?.completed ?? false;
      if (isLive) hasAnyLive = true;

      const homeScore = oddsGame?.scores?.find(s => s.name === oddsGame.home_team)?.score ?? null;
      const awayScore = oddsGame?.scores?.find(s => s.name === oddsGame.away_team)?.score ?? null;

      // currentValue: prefer game log (final stats), fall back to ESPN live box score.
      const logKey = pick.playerId != null ? `${pick.playerId}:${pick.statType.toLowerCase()}` : null;
      let currentValue: number | null = logKey != null ? (logMap.get(logKey) ?? null) : null;
      let progressFraction = 0;

      if (isLive && currentValue == null && oddsGame) {
        const oh = norm(oddsGame.home_team);
        const oa = norm(oddsGame.away_team);
        const espnData = espnDataMap.get(`${oh}:${oa}`);
        if (espnData) {
          const displayName = pick.playerName ?? player?.fullName ?? "";
          const espnStat = getPlayerStat(displayName, pick.statType, espnData.players);
          if (espnStat != null) currentValue = espnStat;
          const gameRow = pick.gameId != null ? gameDbMap.get(pick.gameId) : null;
          progressFraction = gameProgressFraction(gameRow?.game.sport ?? "", espnData.period, espnData.displayClock);
        }
      }

      const lineValue = Number(pick.lineValue);
      const delta = currentValue != null ? Math.round((currentValue - lineValue) * 10) / 10 : null;
      const pacingStatus = classifyPacing(isLive, isFinal, currentValue, lineValue, pick.direction ?? "more", progressFraction);

      return {
        pickId:       pick.id,
        playerName:   pick.playerName ?? player?.fullName ?? "Unknown",
        statType:     pick.statType,
        lineValue,
        direction:    pick.direction,
        result:       pick.result,
        currentValue,
        delta,
        pacingStatus,
        isLive,
        isFinal,
        gameScore: oddsGame ? {
          homeTeam:     oddsGame.home_team,
          awayTeam:     oddsGame.away_team,
          homeScore,
          awayScore,
          commenceTime: oddsGame.commence_time,
          lastUpdate:   oddsGame.last_update,
        } : null,
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
