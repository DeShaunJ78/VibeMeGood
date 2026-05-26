/**
 * External projection scraper — uses confirmed-accessible stats APIs:
 *   NHL: api.nhle.com (skater summary + realtime + goalie summary)
 *   MLB: statsapi.mlb.com (hitting + pitching season stats)
 *   NBA: derived from game logs in DB (no accessible external projection source)
 *   NFL: skipped (off-season)
 */

import { logger } from "../logger";

export interface ScrapedProjection {
  playerName: string;
  sport: string;
  statType: string;
  projectedValue: number;
  source: string;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(tid);
  }
}

// ---------- NHL ----------

interface NHLSkaterSummary {
  playerId: number;
  skaterFullName: string;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  gamesPlayed: number;
  positionCode: string;
}

interface NHLSkaterRealtime {
  playerId: number;
  hits: number;
  blockedShots: number;
  gamesPlayed: number;
}

interface NHLGoalie {
  playerId: number;
  goalieFullName: string;
  saves: number;
  wins: number;
  gamesPlayed: number;
  shotsAgainst: number;
}

async function fetchNHLAll<T>(path: string, sort: string, total: number): Promise<T[]> {
  const PAGE = 100;
  const pages = Math.ceil(total / PAGE);
  const results: T[] = [];
  await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      getJson(
        `https://api.nhle.com/stats/rest/en/${path}?limit=${PAGE}&start=${i * PAGE}` +
        `&cayenneExp=seasonId=20242025%20and%20gameTypeId=2&sort=${sort}&dir=DESC`,
      ).then(d => results.push(...(d.data as T[]))).catch(() => {}),
    ),
  );
  return results;
}

export async function scrapeNHLStats(): Promise<ScrapedProjection[]> {
  try {
    // Get total counts first
    const [summaryMeta, realtimeMeta, goalieMeta] = await Promise.all([
      getJson("https://api.nhle.com/stats/rest/en/skater/summary?limit=1&cayenneExp=seasonId=20242025%20and%20gameTypeId=2"),
      getJson("https://api.nhle.com/stats/rest/en/skater/realtime?limit=1&cayenneExp=seasonId=20242025%20and%20gameTypeId=2"),
      getJson("https://api.nhle.com/stats/rest/en/goalie/summary?limit=1&cayenneExp=seasonId=20242025%20and%20gameTypeId=2"),
    ]);

    const [summaryRows, realtimeRows, goalieRows] = await Promise.all([
      fetchNHLAll<NHLSkaterSummary>("skater/summary", "points", summaryMeta.total as number),
      fetchNHLAll<NHLSkaterRealtime>("skater/realtime", "hits", realtimeMeta.total as number),
      fetchNHLAll<NHLGoalie>("goalie/summary", "wins", goalieMeta.total as number),
    ]);

    // Index realtime stats by playerId
    const realtimeMap = new Map<number, NHLSkaterRealtime>();
    for (const r of realtimeRows) realtimeMap.set(r.playerId, r);

    const out: ScrapedProjection[] = [];

    for (const s of summaryRows) {
      const gp = s.gamesPlayed;
      if (gp < 5) continue;
      const rt = realtimeMap.get(s.playerId);
      const name = s.skaterFullName;

      out.push({ playerName: name, sport: "NHL", statType: "Goals",        projectedValue: round2(s.goals / gp),   source: "nhl_api" });
      out.push({ playerName: name, sport: "NHL", statType: "Assists",       projectedValue: round2(s.assists / gp), source: "nhl_api" });
      out.push({ playerName: name, sport: "NHL", statType: "Points",        projectedValue: round2(s.points / gp),  source: "nhl_api" });
      out.push({ playerName: name, sport: "NHL", statType: "Shots On Goal", projectedValue: round1(s.shots / gp),   source: "nhl_api" });
      if (rt && rt.gamesPlayed > 0) {
        out.push({ playerName: name, sport: "NHL", statType: "Hits",           projectedValue: round1(rt.hits / rt.gamesPlayed),         source: "nhl_api" });
        out.push({ playerName: name, sport: "NHL", statType: "Blocked Shots",  projectedValue: round1(rt.blockedShots / rt.gamesPlayed), source: "nhl_api" });
      }
    }

    for (const g of goalieRows) {
      const gp = g.gamesPlayed;
      if (gp < 5) continue;
      out.push({ playerName: g.goalieFullName, sport: "NHL", statType: "Goalie Saves", projectedValue: round1(g.saves / gp), source: "nhl_api" });
    }

    logger.info({ skaters: summaryRows.length, goalies: goalieRows.length, projections: out.length }, "NHL stats scraped");
    return out;
  } catch (err) {
    logger.error({ err }, "NHL scrape error");
    return [];
  }
}

// ---------- MLB ----------

export async function scrapeMLBStats(): Promise<ScrapedProjection[]> {
  const season = new Date().getFullYear();
  const BASE = "https://statsapi.mlb.com/api/v1";

  try {
    const [hitRes, pitchRes] = await Promise.all([
      getJson(`${BASE}/stats?stats=season&group=hitting&season=${season}&sportId=1&limit=1000`),
      getJson(`${BASE}/stats?stats=season&group=pitching&season=${season}&sportId=1&limit=500`),
    ]);

    const out: ScrapedProjection[] = [];

    // Batters
    for (const split of (hitRes.stats[0]?.splits ?? [])) {
      const p = split.player?.fullName as string | undefined;
      const s = split.stat;
      if (!p || !s) continue;
      const gp = s.gamesPlayed as number;
      if (!gp || gp < 5) continue;

      const hits     = s.hits        as number ?? 0;
      const hrs      = s.homeRuns    as number ?? 0;
      const tb       = s.totalBases  as number ?? 0;
      const rbi      = s.rbi         as number ?? 0;
      const runs     = s.runs        as number ?? 0;
      const sb       = s.stolenBases as number ?? 0;
      const bb       = s.baseOnBalls as number ?? 0;
      const doubles  = s.doubles     as number ?? 0;
      const triples  = s.triples     as number ?? 0;
      const soHitter = s.strikeOuts  as number ?? 0;
      const singles  = hits - doubles - triples - hrs;

      out.push({ playerName: p, sport: "MLB", statType: "Hits",              projectedValue: round2(hits / gp),    source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Home Runs",         projectedValue: round3(hrs / gp),     source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Total Bases",       projectedValue: round2(tb / gp),      source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "RBIs",              projectedValue: round2(rbi / gp),     source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Runs",              projectedValue: round2(runs / gp),    source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Stolen Bases",      projectedValue: round3(sb / gp),      source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Walks",             projectedValue: round2(bb / gp),      source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Doubles",           projectedValue: round2(doubles / gp), source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Triples",           projectedValue: round3(triples / gp), source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Hitter Strikeouts", projectedValue: round2(soHitter / gp), source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Singles",           projectedValue: round2(Math.max(0, singles) / gp), source: "mlb_api" });
      // Combo
      out.push({ playerName: p, sport: "MLB", statType: "Hits+Runs+RBIs",   projectedValue: round2((hits + runs + rbi) / gp), source: "mlb_api" });
    }

    // Pitchers (per start)
    for (const split of (pitchRes.stats[0]?.splits ?? [])) {
      const p = split.player?.fullName as string | undefined;
      const s = split.stat;
      if (!p || !s) continue;
      const gs = s.gamesStarted as number;
      if (!gs || gs < 3) continue;

      const soP       = s.strikeOuts  as number ?? 0;
      const bbP       = s.baseOnBalls as number ?? 0;
      const hAllowed  = s.hits        as number ?? 0;
      const erAllowed = s.earnedRuns  as number ?? 0;
      // Pitching outs: inningsPitched is stored as fractional (e.g. "187.2" = 187 outs + 2/3)
      const ipStr = s.inningsPitched as string ?? "0";
      const ipParts = ipStr.split(".");
      const outs = (parseInt(ipParts[0] ?? "0") * 3) + parseInt(ipParts[1] ?? "0");
      const outsPerStart = outs / gs;

      out.push({ playerName: p, sport: "MLB", statType: "Pitcher Strikeouts", projectedValue: round1(soP / gs),       source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Walks Allowed",       projectedValue: round1(bbP / gs),       source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Hits Allowed",        projectedValue: round1(hAllowed / gs),  source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Earned Runs Allowed", projectedValue: round2(erAllowed / gs), source: "mlb_api" });
      out.push({ playerName: p, sport: "MLB", statType: "Pitching Outs",       projectedValue: round1(outsPerStart),   source: "mlb_api" });
    }

    logger.info({ projections: out.length }, "MLB stats scraped");
    return out;
  } catch (err) {
    logger.error({ err }, "MLB scrape error");
    return [];
  }
}

// ---------- Helpers ----------

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
