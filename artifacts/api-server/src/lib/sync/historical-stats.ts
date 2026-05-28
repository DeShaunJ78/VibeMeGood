import { db } from "@workspace/db";
import { playerGameLogsTable, playersTable } from "@workspace/db/schema";
import { logger } from "../logger";
import { normalizeName } from "../projections/name-match";
// CSV helpers (mirrors nfl-advanced.ts — kept local to avoid cross-module coupling)
async function downloadCSVRaw(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "PropEdge/1.0 nflverse-ingest" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`CSV download failed: ${res.status} ${url}`);
  return res.text();
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const result: Array<Record<string, string>> = [];
  for (let li = 1; li < lines.length; li++) {
    const values = parseCSVLine(lines[li]);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    result.push(row);
  }
  return result;
}

function csvNum(v: string | undefined): number {
  if (!v || v === "NA" || v === "NaN" || v === "" || v === "Inf" || v === "-Inf") return 0;
  const n = parseFloat(v);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

const FETCH_HEADERS = {
  "User-Agent": "VibeMeGood/1.0 Historical Stats",
  "Accept":     "application/json",
};

async function getJson(url: string, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  } finally {
    clearTimeout(tid);
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Faster upsert — skip if conflict on (playerId, gameDate, statType)
async function upsertLog(
  playerId: number,
  gameDate: string,
  statType: string,
  value: number,
  source: string,
): Promise<void> {
  await db
    .insert(playerGameLogsTable)
    .values({ playerId, gameDate, statType, value: value.toString(), source })
    .onConflictDoNothing();
}

// Run `fn` over `items` in parallel batches of `size`, with optional inter-batch delay
async function batch<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<number>,
  delayMs = 50,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(fn));
    for (const r of results) if (r.status === "fulfilled") total += r.value;
    if (delayMs > 0 && i + size < items.length) await sleep(delayMs);
  }
  return total;
}

// ─── NBA via ESPN team schedules + game summary boxscores ─────────────────────
//
// Strategy: fetch all 30 team schedules (30 calls) → deduplicate ~1 230 unique
// completed game IDs → fetch each game's boxscore summary (batched 20 at a time).
// Stat names confirmed: MIN,PTS,FG,3PT,FT,REB,AST,TO,STL,BLK,OREB,DREB,PF,+/-

async function backfillNBA(
  allDbPlayers: typeof playersTable.$inferSelect[],
  seasons: number[],   // e.g. [2025] = 2024-25 season; [2024] = 2023-24
): Promise<number> {
  const nbaPlayers = allDbPlayers.filter(p => p.sport === "NBA");
  if (nbaPlayers.length === 0) return 0;

  // Normalised name → DB player id
  const nameToId = new Map<string, number>();
  for (const p of nbaPlayers) nameToId.set(normalizeName(p.fullName), p.id);

  // Helper: resolve ESPN display name to our DB player id
  function resolvePlayer(displayName: string): number | null {
    const norm  = normalizeName(displayName);
    const exact = nameToId.get(norm);
    if (exact) return exact;
    // Last-name + first-initial fallback
    const parts = norm.split(" ");
    const last  = parts[parts.length - 1];
    const init  = parts[0]?.[0];
    for (const [n, id] of nameToId) {
      const np = n.split(" ");
      if (np[np.length - 1] === last && np[0]?.[0] === init) return id;
    }
    return null;
  }

  // Fetch all 30 NBA team IDs from ESPN
  let teamIds: number[] = [];
  try {
    const teamsData = await getJson(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams",
    );
    teamIds = (teamsData?.sports?.[0]?.leagues?.[0]?.teams ?? [])
      .map((t: any) => Number(t?.team?.id))
      .filter(Boolean);
  } catch {
    // Fallback to hardcoded ESPN team IDs
    teamIds = [
      1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
      17,18,19,20,21,22,23,24,25,26,27,28,29,30,38,40,
    ];
  }

  let grandTotal = 0;

  for (const season of seasons) {
    // Collect completed game {id, date} from all team schedules
    const gameMap = new Map<string, string>(); // eventId → YYYY-MM-DD

    await batch(teamIds, 10, async (teamId) => {
      try {
        const data = await getJson(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=${season}`,
        );
        for (const ev of (data?.events ?? [])) {
          const completed = ev?.competitions?.[0]?.status?.type?.completed === true;
          if (!completed || !ev.id) continue;
          const dateStr = (ev.date as string | undefined)?.slice(0, 10);
          if (dateStr) gameMap.set(String(ev.id), dateStr);
        }
      } catch { /* skip failed team */ }
      return 0;
    }, 200);

    const games = Array.from(gameMap.entries()); // [eventId, YYYY-MM-DD]
    logger.info({ season, games: games.length }, "NBA: schedule collected");

    const seasonTotal = await batch(games, 20, async ([eventId, gameDate]) => {
      try {
        const summary = await getJson(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`,
          10000,
        );
        const boxscore = summary?.boxscore;
        if (!boxscore) return 0;

        let count = 0;
        for (const teamSection of (boxscore.players ?? [])) {
          for (const statsSection of (teamSection.statistics ?? [])) {
            const names: string[] = statsSection.names ?? [];
            const idx: Record<string, number> = {};
            names.forEach((n, i) => { idx[n] = i; });

            for (const entry of (statsSection.athletes ?? [])) {
              const dbId = resolvePlayer(entry?.athlete?.displayName ?? "");
              if (!dbId) continue;

              const statsArr: string[] = entry.stats ?? [];
              const get = (key: string): number => {
                const i = idx[key];
                if (i === undefined || !statsArr[i]) return 0;
                const v = statsArr[i];
                return v.includes("-") ? (parseInt(v.split("-")[0]) || 0) : (parseFloat(v) || 0);
              };

              const min = get("MIN");
              if (min < 5) continue;

              const pts    = get("PTS");
              const reb    = get("REB");
              const ast    = get("AST");
              const stl    = get("STL");
              const blk    = get("BLK");
              const tov    = get("TO");
              const threes = get("3PT");

              const source = `espn_nba_${season}`;
              const logs: [string, number][] = [
                ["Points",      pts],
                ["Rebounds",    reb],
                ["Assists",     ast],
                ["Steals",      stl],
                ["Blocked Shots", blk],
                ["Turnovers",   tov],
                ["3-PT Made",   threes],
                ["Pts+Rebs+Asts", pts + reb + ast],
                ["Pts+Rebs",    pts + reb],
                ["Pts+Asts",    pts + ast],
                ["Rebs+Asts",   reb + ast],
              ];

              for (const [statType, value] of logs) {
                await upsertLog(dbId, gameDate, statType, value, source);
                count++;
              }
            }
          }
        }
        return count;
      } catch {
        return 0;
      }
    }, 50);

    grandTotal += seasonTotal;
    logger.info({ season, seasonTotal }, "NBA season backfill complete");
  }

  logger.info({ grandTotal }, "NBA historical backfill complete");
  return grandTotal;
}

// ─── MLB via MLB Stats API per-player game logs ───────────────────────────────
//
// Strategy: GET /sports/1/players?season=N (1 call) → build name→mlbId map →
// for each DB MLB player: GET /people/{id}/stats?stats=gameLog&season=N&group=hitting
//                     and GET /people/{id}/stats?stats=gameLog&season=N&group=pitching
// Date field in splits: split.date (already YYYY-MM-DD).

async function backfillMLB(
  allDbPlayers: typeof playersTable.$inferSelect[],
  seasons: number[],
): Promise<number> {
  const mlbDbPlayers = allDbPlayers.filter(p => p.sport === "MLB");
  if (mlbDbPlayers.length === 0) return 0;

  const BASE = "https://statsapi.mlb.com/api/v1";
  let grandTotal = 0;

  for (const season of seasons) {
    try {
      // Build MLB name→id map from the official roster
      const rosterRes = await getJson(`${BASE}/sports/1/players?season=${season}&limit=2500`);
      const mlbRoster: Array<{ id: number; fullName: string }> =
        (rosterRes?.people ?? []).map((p: any) => ({ id: p.id, fullName: p.fullName }));

      // Match each DB player to an MLB roster ID
      type PlayerTarget = { dbId: number; mlbId: number };
      const targets: PlayerTarget[] = [];
      for (const p of mlbDbPlayers) {
        const normDb = normalizeName(p.fullName);
        // Exact match first
        let found = mlbRoster.find(r => normalizeName(r.fullName) === normDb);
        if (!found) {
          // Levenshtein ≤ 2
          let best: typeof mlbRoster[0] | null = null;
          let bestD = 3;
          for (const r of mlbRoster) {
            const d = lev(normDb, normalizeName(r.fullName));
            if (d < bestD) { bestD = d; best = r; }
          }
          if (best) found = best;
        }
        if (found) targets.push({ dbId: p.id, mlbId: found.id });
      }

      logger.info({ season, matched: targets.length, total: mlbDbPlayers.length },
        "MLB: players matched to roster");

      // Fetch hitting + pitching logs for each matched player (batched 5 at a time)
      const seasonTotal = await batch(targets, 5, async ({ dbId, mlbId }) => {
        let count = 0;
        const source = `mlb_api_${season}`;

        // Hitting
        try {
          const hitData = await getJson(
            `${BASE}/people/${mlbId}/stats?stats=gameLog&season=${season}&group=hitting`,
          );
          for (const split of (hitData?.stats?.[0]?.splits ?? [])) {
            const gameDate = split.date as string | undefined;
            const s = split.stat;
            if (!gameDate || !s) continue;

            const hits    = s.hits ?? 0;
            const hrs     = s.homeRuns ?? 0;
            const tb      = s.totalBases ?? 0;
            const rbi     = s.rbi ?? 0;
            const runs    = s.runs ?? 0;
            const sb      = s.stolenBases ?? 0;
            const bb      = s.baseOnBalls ?? 0;
            const doubles = s.doubles ?? 0;
            const triples = s.triples ?? 0;
            const so      = s.strikeOuts ?? 0;
            const singles = Math.max(0, hits - doubles - triples - hrs);

            const logs: [string, number][] = [
              ["Hits",             hits],
              ["Home Runs",        hrs],
              ["Total Bases",      tb],
              ["RBIs",             rbi],
              ["Runs",             runs],
              ["Stolen Bases",     sb],
              ["Walks",            bb],
              ["Doubles",          doubles],
              ["Triples",          triples],
              ["Hitter Strikeouts", so],
              ["Singles",          singles],
              ["Hits+Runs+RBIs",   hits + runs + rbi],
            ];

            for (const [statType, value] of logs) {
              await upsertLog(dbId, gameDate, statType, value, source);
              count++;
            }
          }
        } catch { /* hitting log unavailable */ }

        // Pitching (starters only)
        try {
          const pitchData = await getJson(
            `${BASE}/people/${mlbId}/stats?stats=gameLog&season=${season}&group=pitching`,
          );
          for (const split of (pitchData?.stats?.[0]?.splits ?? [])) {
            const gameDate = split.date as string | undefined;
            const s = split.stat;
            if (!gameDate || !s) continue;
            if (!s.gamesStarted || s.gamesStarted < 1) continue;

            const soP      = s.strikeOuts ?? 0;
            const bbP      = s.baseOnBalls ?? 0;
            const hAllowed = s.hits ?? 0;
            const er       = s.earnedRuns ?? 0;
            const ipStr    = (s.inningsPitched as string | undefined) ?? "0";
            const ipParts  = ipStr.split(".");
            const outs     = (parseInt(ipParts[0] ?? "0") * 3) + parseInt(ipParts[1] ?? "0");

            const logs: [string, number][] = [
              ["Pitcher Strikeouts",  soP],
              ["Walks Allowed",       bbP],
              ["Hits Allowed",        hAllowed],
              ["Earned Runs Allowed", er],
              ["Pitching Outs",       outs],
            ];

            for (const [statType, value] of logs) {
              await upsertLog(dbId, gameDate, statType, value, source);
              count++;
            }
          }
        } catch { /* pitching log unavailable */ }

        return count;
      }, 100);

      grandTotal += seasonTotal;
      logger.info({ season, seasonTotal }, "MLB season backfill complete");
    } catch (e) {
      logger.warn({ err: e, season }, "MLB backfill season failed");
    }
  }

  logger.info({ grandTotal }, "MLB historical backfill complete");
  return grandTotal;
}

// ─── NHL via NHL API team rosters + per-player game logs ─────────────────────

const NHL_TEAMS = [
  "ANA","BOS","BUF","CAR","CBJ","CGY","CHI","COL",
  "DAL","DET","EDM","FLA","LAK","MIN","MTL","NJD",
  "NSH","NYI","NYR","OTT","PHI","PIT","SEA","SJS",
  "STL","TBL","TOR","UTA","VAN","VGK","WPG","WSH",
];

async function backfillNHL(
  allDbPlayers: typeof playersTable.$inferSelect[],
  seasons: string[],   // e.g. ["20232024", "20242025"]
): Promise<number> {
  const nhlDbPlayers = allDbPlayers.filter(p => p.sport === "NHL");
  if (nhlDbPlayers.length === 0) return 0;

  const dbNormMap = new Map<string, number>();
  for (const p of nhlDbPlayers) dbNormMap.set(normalizeName(p.fullName), p.id);

  let grandTotal = 0;

  for (const season of seasons) {
    // Build NHL name→id map from all 32 team rosters
    const nhlIdMap = new Map<string, number>(); // normalised name → NHL player id

    await batch(NHL_TEAMS, 8, async (abbr) => {
      try {
        const data = await getJson(`https://api-web.nhle.com/v1/roster/${abbr}/${season}`);
        for (const group of ["forwards", "defensemen", "goalies"] as const) {
          for (const p of (data?.[group] ?? [])) {
            const first = p.firstName?.default ?? "";
            const last  = p.lastName?.default ?? "";
            if (!first || !last || !p.id) continue;
            nhlIdMap.set(normalizeName(`${first} ${last}`), p.id as number);
          }
        }
      } catch { /* team may not exist in this season */ }
      return 0;
    }, 100);

    logger.info({ season, rosterSize: nhlIdMap.size }, "NHL: rosters collected");

    // Match our DB players to NHL IDs
    type Target = { dbId: number; nhlId: number };
    const targets: Target[] = [];
    for (const [normName, dbId] of dbNormMap) {
      const nhlId = nhlIdMap.get(normName);
      if (nhlId) targets.push({ dbId, nhlId });
    }

    logger.info({ season, matched: targets.length }, "NHL: players matched");

    const seasonTotal = await batch(targets, 5, async ({ dbId, nhlId }) => {
      let count = 0;
      const source = `nhl_api_${season}`;
      try {
        const data = await getJson(
          `https://api-web.nhle.com/v1/player/${nhlId}/game-log/${season}/2`,
        );
        for (const game of (data?.gameLog ?? [])) {
          const gameDate = game.gameDate as string | undefined;
          if (!gameDate) continue;

          const goals   = game.goals ?? 0;
          const assists = game.assists ?? 0;
          const shots   = game.shots ?? 0;
          const ppp     = game.powerPlayPoints ?? 0;

          const logs: [string, number][] = [
            ["Goals",              goals],
            ["Assists",            assists],
            ["Shots On Goal",      shots],
            ["Power Play Points",  ppp],
            ["Goal + Assist",      goals + assists],
          ];

          for (const [statType, value] of logs) {
            await upsertLog(dbId, gameDate, statType, value, source);
            count++;
          }
        }
      } catch { /* player may have no data for this season */ }
      return count;
    }, 100);

    grandTotal += seasonTotal;
    logger.info({ season, seasonTotal }, "NHL season backfill complete");
  }

  logger.info({ grandTotal }, "NHL historical backfill complete");
  return grandTotal;
}

// ─── NFL via nflverse GitHub CSV releases ─────────────────────────────────────
//
// One row per player per week in player_stats_{season}.csv.
// Columns used: player_display_name, season, week, season_type,
//   passing_yards, passing_tds, rushing_yards, rushing_tds,
//   receptions, receiving_yards, receiving_tds, fantasy_points.
// game_date is constructed as Thursday of week 1 + (week-1)*7 days.

// NFL season week-1 Thursday dates (first game of each season)
const NFL_SEASON_STARTS: Record<number, string> = {
  2024: "2024-09-05",
  2025: "2025-09-04",
};

function nflWeekToDate(season: number, week: number): string {
  const base = NFL_SEASON_STARTS[season] ?? `${season}-09-04`;
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + (week - 1) * 7);
  return d.toISOString().slice(0, 10);
}

const NFL_STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`;

async function backfillNFL(
  allDbPlayers: typeof playersTable.$inferSelect[],
  seasons: number[],
): Promise<number> {
  const nflDbPlayers = allDbPlayers.filter(p => p.sport === "NFL");
  if (nflDbPlayers.length === 0) return 0;

  // Normalised name → DB player id
  const nameToId = new Map<string, number>();
  for (const p of nflDbPlayers) nameToId.set(normalizeName(p.fullName), p.id);

  // Helper: resolve CSV display name → DB player id
  function resolveNfl(displayName: string): number | null {
    const norm = normalizeName(displayName);
    const exact = nameToId.get(norm);
    if (exact) return exact;
    // Last-name + first-initial fallback
    const parts = norm.split(" ");
    const last = parts[parts.length - 1];
    const init = parts[0]?.[0];
    for (const [n, id] of nameToId) {
      const np = n.split(" ");
      if (np[np.length - 1] === last && np[0]?.[0] === init) return id;
    }
    return null;
  }

  let grandTotal = 0;

  for (const season of seasons) {
    try {
      let rows: Array<Record<string, string>>;
      try {
        const text = await downloadCSVRaw(NFL_STATS_URL(season));
        rows = parseCSV(text);
      } catch (e) {
        logger.warn({ season, err: e }, "NFL CSV not available — skipping season");
        continue;
      }

      // Filter to regular season only
      const regRows = rows.filter(r => r.season_type === "REG");
      logger.info({ season, rows: regRows.length }, "NFL: CSV rows loaded");

      const source = `nfl_csv_${season}`;
      let count = 0;

      for (const row of regRows) {
        const dbId = resolveNfl(row.player_display_name ?? "");
        if (!dbId) continue;

        const week = parseInt(row.week ?? "0");
        if (!week) continue;
        const gameDate = nflWeekToDate(season, week);

        const rushYds  = csvNum(row.rushing_yards);
        const recYds   = csvNum(row.receiving_yards);
        const passYds  = csvNum(row.passing_yards);
        const recs     = csvNum(row.receptions);
        const rushTds  = csvNum(row.rushing_tds);
        const recTds   = csvNum(row.receiving_tds);
        const passTds  = csvNum(row.passing_tds);

        const logs: [string, number][] = [
          ["Rush Yards",      rushYds],
          ["Receiving Yards", recYds],
          ["Pass Yards",      passYds],
          ["Receptions",      recs],
          ["Rush TDs",        rushTds],
          ["Rec TDs",         recTds],
          ["Pass TDs",        passTds],
        ];

        for (const [statType, value] of logs) {
          await upsertLog(dbId, gameDate, statType, value, source);
          count++;
        }
      }

      grandTotal += count;
      logger.info({ season, count }, "NFL season backfill complete");
    } catch (e) {
      logger.warn({ season, err: e }, "NFL season backfill failed");
    }
  }

  logger.info({ grandTotal }, "NFL historical backfill complete");
  return grandTotal;
}

// ─── Levenshtein (local copy — avoids import cycle) ──────────────────────────
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function backfillHistoricalStats(
  options: { nba?: boolean; mlb?: boolean; nhl?: boolean; nfl?: boolean } = {
    nba: true, mlb: true, nhl: true, nfl: true,
  },
): Promise<{ nba: number; mlb: number; nhl: number; nfl: number; total: number }> {
  const allPlayers = await db.select().from(playersTable);
  const results = { nba: 0, mlb: 0, nhl: 0, nfl: 0, total: 0 };

  if (options.nba !== false) {
    // season param = ending year of season: 2025 = 2024-25, 2024 = 2023-24
    results.nba = await backfillNBA(allPlayers, [2024, 2025]);
  }

  if (options.mlb !== false) {
    results.mlb = await backfillMLB(allPlayers, [2023, 2024, 2025]);
  }

  if (options.nhl !== false) {
    results.nhl = await backfillNHL(allPlayers, ["20232024", "20242025"]);
  }

  if (options.nfl !== false) {
    results.nfl = await backfillNFL(allPlayers, [2024, 2025]);
  }

  results.total = results.nba + results.mlb + results.nhl + results.nfl;
  logger.info(results, "Historical stats backfill complete");
  return results;
}
