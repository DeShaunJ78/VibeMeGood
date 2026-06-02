import { db } from "@workspace/db";
import { gamesTable, teamsTable } from "@workspace/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { logger } from "../logger";

/**
 * NFL home-stadium coordinates + roof type, keyed by ESPN team abbreviation.
 * `dome: true` means weather is irrelevant (fixed/retractable roof games are
 * played indoors here) — we flag the game indoor and skip the API call.
 */
const NFL_STADIUMS: Record<string, { lat: number; lon: number; dome: boolean }> = {
  ARI: { lat: 33.5276, lon: -112.2626, dome: true },  // State Farm (retractable)
  ATL: { lat: 33.7554, lon: -84.4008,  dome: true },  // Mercedes-Benz (retractable)
  BAL: { lat: 39.2780, lon: -76.6227,  dome: false },
  BUF: { lat: 42.7738, lon: -78.7870,  dome: false },
  CAR: { lat: 35.2258, lon: -80.8528,  dome: false },
  CHI: { lat: 41.8623, lon: -87.6167,  dome: false },
  CIN: { lat: 39.0954, lon: -84.5160,  dome: false },
  CLE: { lat: 41.5061, lon: -81.6995,  dome: false },
  DAL: { lat: 32.7473, lon: -97.0945,  dome: true },   // AT&T (retractable)
  DEN: { lat: 39.7439, lon: -105.0201, dome: false },
  DET: { lat: 42.3400, lon: -83.0456,  dome: true },   // Ford Field (dome)
  GB:  { lat: 44.5013, lon: -88.0622,  dome: false },
  HOU: { lat: 29.6847, lon: -95.4107,  dome: true },   // NRG (retractable)
  IND: { lat: 39.7601, lon: -86.1639,  dome: true },   // Lucas Oil (retractable)
  JAX: { lat: 30.3239, lon: -81.6373,  dome: false },
  KC:  { lat: 39.0489, lon: -94.4839,  dome: false },
  LV:  { lat: 36.0909, lon: -115.1833, dome: true },   // Allegiant (dome)
  LAC: { lat: 33.9535, lon: -118.3392, dome: true },   // SoFi (covered)
  LAR: { lat: 33.9535, lon: -118.3392, dome: true },   // SoFi (covered)
  MIA: { lat: 25.9580, lon: -80.2389,  dome: false },
  MIN: { lat: 44.9736, lon: -93.2575,  dome: true },   // U.S. Bank (dome)
  NE:  { lat: 42.0909, lon: -71.2643,  dome: false },
  NO:  { lat: 29.9511, lon: -90.0812,  dome: true },   // Caesars Superdome
  NYG: { lat: 40.8135, lon: -74.0745,  dome: false },  // MetLife
  NYJ: { lat: 40.8135, lon: -74.0745,  dome: false },  // MetLife
  PHI: { lat: 39.9008, lon: -75.1675,  dome: false },
  PIT: { lat: 40.4468, lon: -80.0158,  dome: false },
  SEA: { lat: 47.5952, lon: -122.3316, dome: false },
  SF:  { lat: 37.4030, lon: -121.9698, dome: false },
  TB:  { lat: 27.9759, lon: -82.5033,  dome: false },
  TEN: { lat: 36.1665, lon: -86.7713,  dome: false },
  WAS: { lat: 38.9077, lon: -76.8645,  dome: false },
};

export interface WeatherMeta {
  isOutdoor: boolean;
  temp?: number;       // Fahrenheit
  windSpeed?: number;  // mph
  fetchedAt: string;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Fetch temperature + wind at kickoff for upcoming outdoor NFL games via
 * Open-Meteo (no API key) and store on games.metadata.weather. Dome games are
 * flagged indoor without an API call. Window: now → +7 days (forecast horizon).
 */
export async function syncWeather(): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const games = await db
    .select({ id: gamesTable.id, startTime: gamesTable.startTime, homeTeamId: gamesTable.homeTeamId, metadata: gamesTable.metadata })
    .from(gamesTable)
    .where(and(
      eq(gamesTable.sport, "NFL"),
      gte(gamesTable.startTime, now),
      lte(gamesTable.startTime, horizon),
    ));
  if (!games.length) {
    logger.info("weather: no upcoming NFL games in forecast window");
    return 0;
  }

  const teamIds = [...new Set(games.map(g => g.homeTeamId))];
  const teams = await db
    .select({ id: teamsTable.id, abbreviation: teamsTable.abbreviation })
    .from(teamsTable)
    .where(eq(teamsTable.sport, "NFL"));
  const abbrById = new Map(teams.filter(t => teamIds.includes(t.id)).map(t => [t.id, (t.abbreviation ?? "").toUpperCase()]));

  let updated = 0;

  for (const g of games) {
    const abbr = abbrById.get(g.homeTeamId);
    const stadium = abbr ? NFL_STADIUMS[abbr] : undefined;
    if (!stadium) continue;

    let weather: WeatherMeta;
    if (stadium.dome) {
      weather = { isOutdoor: false, fetchedAt: new Date().toISOString() };
    } else {
      try {
        const date = ymd(g.startTime);
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lon}` +
          `&hourly=temperature_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph` +
          `&start_date=${date}&end_date=${date}&timezone=UTC`;
        const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) {
          logger.warn({ gameId: g.id, status: res.status }, "weather: Open-Meteo fetch failed");
          continue;
        }
        const data = await res.json() as { hourly?: { time?: string[]; temperature_2m?: number[]; wind_speed_10m?: number[] } };
        const times = data.hourly?.time ?? [];
        const temps = data.hourly?.temperature_2m ?? [];
        const winds = data.hourly?.wind_speed_10m ?? [];

        // Pick the forecast hour closest to kickoff.
        const kickoff = g.startTime.getTime();
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < times.length; i++) {
          const dist = Math.abs(new Date(times[i] + "Z").getTime() - kickoff);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
        weather = {
          isOutdoor: true,
          temp: bestIdx >= 0 ? temps[bestIdx] : undefined,
          windSpeed: bestIdx >= 0 ? winds[bestIdx] : undefined,
          fetchedAt: new Date().toISOString(),
        };
      } catch (e) {
        logger.warn({ gameId: g.id, err: e }, "weather: fetch error");
        continue;
      }
    }

    const meta = { ...(g.metadata as Record<string, unknown> ?? {}), weather };
    await db.update(gamesTable).set({ metadata: meta, updatedAt: new Date() }).where(eq(gamesTable.id, g.id));
    updated++;
  }

  logger.info({ updated }, "syncWeather complete");
  return updated;
}
