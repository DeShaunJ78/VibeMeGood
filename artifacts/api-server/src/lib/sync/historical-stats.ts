import { db } from "@workspace/db";
import {
  playerGameLogsTable,
  playersTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import { matchPlayer } from "../projections/name-match";

const HEADERS = {
  "User-Agent": "VibeMeGood/1.0 Historical Stats",
  "Accept": "application/json",
};

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(tid);
  }
}

async function upsertGameLog(
  playerId: number,
  gameDate: string,
  statType: string,
  value: number,
  source: string,
): Promise<void> {
  const existing = await db
    .select({ id: playerGameLogsTable.id })
    .from(playerGameLogsTable)
    .where(and(
      eq(playerGameLogsTable.playerId, playerId),
      eq(playerGameLogsTable.gameDate, gameDate),
      eq(playerGameLogsTable.statType, statType),
    ))
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(playerGameLogsTable).values({
    playerId,
    gameDate,
    statType,
    value: value.toString(),
    source,
  });
}

// ── NBA — ESPN sports.core per-game logs ──────────────────────────────
async function backfillNBA(
  players: typeof playersTable.$inferSelect[],
  seasons: number[],
): Promise<number> {
  const nbaPlayers = players.filter(p => p.sport === "NBA");
  let total = 0;

  for (const player of nbaPlayers) {
    const ppId = (player.externalIds as any)?.pp_id;
    if (!ppId) continue;

    for (const season of seasons) {
      try {
        const seasonStr = `${season}${season + 1}`;
        const url =
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/` +
          `athletes/${ppId}/gamelog?season=${seasonStr}`;

        const data = await getJson(url);
        const categories = data?.categories ?? [];
        const events = data?.events?.eventsByWeek ?? [];

        const statIndex: Record<string, number> = {};
        for (const cat of categories) {
          const names: string[] = cat.names ?? [];
          names.forEach((n: string, i: number) => {
            statIndex[n] = i;
          });
        }

        for (const week of events) {
          for (const event of (week.events ?? [])) {
            const gameDate = event.gameDate?.split("T")[0];
            if (!gameDate) continue;

            const statsArr: number[] =
              event.athlete?.statistics?.[0]?.values ?? [];
            if (!statsArr.length) continue;

            const get = (key: string) =>
              statIndex[key] !== undefined
                ? (statsArr[statIndex[key]] ?? 0)
                : 0;

            const pts = get("PTS");
            const reb = get("REB");
            const ast = get("AST");
            const stl = get("STL");
            const blk = get("BLK");
            const tov = get("TO");
            const threes = get("3PM");
            const min = get("MIN");

            if (min < 5) continue;

            const logs: [string, number][] = [
              ["Points", pts],
              ["Rebounds", reb],
              ["Assists", ast],
              ["Steals", stl],
              ["Blocked Shots", blk],
              ["Turnovers", tov],
              ["3-PT Made", threes],
              ["Pts+Rebs+Asts", pts + reb + ast],
              ["Pts+Rebs", pts + reb],
              ["Pts+Asts", pts + ast],
              ["Rebs+Asts", reb + ast],
            ];

            for (const [statType, value] of logs) {
              await upsertGameLog(
                player.id,
                gameDate,
                statType,
                value,
                `espn_nba_${season}`,
              );
              total++;
            }
          }
        }
      } catch {
        // Player may not have ESPN ID or data — skip silently
      }
    }
  }

  logger.info({ total }, "NBA historical backfill complete");
  return total;
}

// ── MLB — statsapi.mlb.com per-game logs ─────────────────────────────
async function backfillMLB(
  players: typeof playersTable.$inferSelect[],
  seasons: number[],
): Promise<number> {
  const mlbPlayers = players.filter(p => p.sport === "MLB");
  let total = 0;
  const BASE = "https://statsapi.mlb.com/api/v1";

  const allPlayers = mlbPlayers.map(p => ({
    id: p.id,
    fullName: p.fullName,
    sport: p.sport,
  }));

  for (const season of seasons) {
    try {
      const [hitRes, pitchRes] = await Promise.all([
        getJson(
          `${BASE}/stats?stats=gameLog&group=hitting` +
          `&season=${season}&sportId=1&limit=10000`,
        ),
        getJson(
          `${BASE}/stats?stats=gameLog&group=pitching` +
          `&season=${season}&sportId=1&limit=5000`,
        ),
      ]);

      for (const split of (hitRes.stats?.[0]?.splits ?? [])) {
        const playerName = split.player?.fullName as string;
        const gameDate = split.date as string;
        const s = split.stat;
        if (!playerName || !gameDate || !s) continue;

        const playerRef = matchPlayer(playerName, allPlayers);
        if (!playerRef) continue;

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
          ["Hits", hits],
          ["Home Runs", hrs],
          ["Total Bases", tb],
          ["RBIs", rbi],
          ["Runs", runs],
          ["Stolen Bases", sb],
          ["Walks", bb],
          ["Doubles", doubles],
          ["Triples", triples],
          ["Hitter Strikeouts", so],
          ["Singles", singles],
          ["Hits+Runs+RBIs", hits + runs + rbi],
        ];

        for (const [statType, value] of logs) {
          await upsertGameLog(
            playerRef.id,
            gameDate,
            statType,
            value,
            `mlb_api_${season}`,
          );
          total++;
        }
      }

      for (const split of (pitchRes.stats?.[0]?.splits ?? [])) {
        const playerName = split.player?.fullName as string;
        const gameDate = split.date as string;
        const s = split.stat;
        if (!playerName || !gameDate || !s) continue;

        const playerRef = matchPlayer(playerName, allPlayers);
        if (!playerRef) continue;

        if (!s.gamesStarted || s.gamesStarted < 1) continue;

        const soP      = s.strikeOuts ?? 0;
        const bbP      = s.baseOnBalls ?? 0;
        const hAllowed = s.hits ?? 0;
        const er       = s.earnedRuns ?? 0;

        const ipStr   = (s.inningsPitched as string) ?? "0";
        const ipParts = ipStr.split(".");
        const outs =
          (parseInt(ipParts[0] ?? "0") * 3) +
          parseInt(ipParts[1] ?? "0");

        const logs: [string, number][] = [
          ["Pitcher Strikeouts", soP],
          ["Walks Allowed", bbP],
          ["Hits Allowed", hAllowed],
          ["Earned Runs Allowed", er],
          ["Pitching Outs", outs],
        ];

        for (const [statType, value] of logs) {
          await upsertGameLog(
            playerRef.id,
            gameDate,
            statType,
            value,
            `mlb_api_${season}`,
          );
          total++;
        }
      }
    } catch (e) {
      logger.warn({ err: e, season }, "MLB backfill season failed");
    }
  }

  logger.info({ total }, "MLB historical backfill complete");
  return total;
}

// ── NHL — api-web.nhle.com per-game logs ─────────────────────────────
async function backfillNHL(
  players: typeof playersTable.$inferSelect[],
  seasons: string[],
): Promise<number> {
  const nhlPlayers = players.filter(p => p.sport === "NHL");
  let total = 0;

  for (const player of nhlPlayers) {
    const ppId = (player.externalIds as any)?.pp_id;
    if (!ppId) continue;

    for (const season of seasons) {
      try {
        const url =
          `https://api-web.nhle.com/v1/player/${ppId}` +
          `/game-log/${season}/2`;

        const data = await getJson(url);
        const games = data?.gameLog ?? [];

        for (const game of games) {
          const gameDate = game.gameDate as string;
          if (!gameDate) continue;

          const goals   = game.goals ?? 0;
          const assists = game.assists ?? 0;
          const shots   = game.shots ?? 0;
          const ppp     = game.powerPlayPoints ?? 0;

          const logs: [string, number][] = [
            ["Goals", goals],
            ["Assists", assists],
            ["Shots On Goal", shots],
            ["Power Play Points", ppp],
            ["Goal + Assist", goals + assists],
          ];

          for (const [statType, value] of logs) {
            await upsertGameLog(
              player.id,
              gameDate,
              statType,
              value,
              `nhl_api_${season}`,
            );
            total++;
          }
        }
      } catch {
        // Player may not have NHL ID — skip
      }
    }
  }

  logger.info({ total }, "NHL historical backfill complete");
  return total;
}

// ── Main export ───────────────────────────────────────────────────────
export async function backfillHistoricalStats(
  options: {
    nba?: boolean;
    mlb?: boolean;
    nhl?: boolean;
  } = { nba: true, mlb: true, nhl: true },
): Promise<{
  nba: number;
  mlb: number;
  nhl: number;
  total: number;
}> {
  const allPlayers = await db.select().from(playersTable);

  const results = { nba: 0, mlb: 0, nhl: 0, total: 0 };

  if (options.nba) {
    results.nba = await backfillNBA(allPlayers, [2023, 2024]);
  }

  if (options.mlb) {
    results.mlb = await backfillMLB(allPlayers, [2023, 2024, 2025]);
  }

  if (options.nhl) {
    results.nhl = await backfillNHL(allPlayers, ["20232024", "20242025"]);
  }

  results.total = results.nba + results.mlb + results.nhl;

  logger.info(results, "Historical stats backfill complete");
  return results;
}
