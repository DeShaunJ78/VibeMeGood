import { db } from "@workspace/db";
import { gamesTable, teamsTable } from "@workspace/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { logger } from "../logger";

const SPORT_ENDPOINTS: Record<string, string> = {
  NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  WNBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
  NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
};

function formatESPNDate(d: Date): string {
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${dy}`;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function findOrCreateTeam(
  sport: string,
  abbr: string,
): Promise<typeof teamsTable.$inferSelect> {
  let [team] = await db
    .select()
    .from(teamsTable)
    .where(and(eq(teamsTable.abbreviation, abbr), eq(teamsTable.sport, sport)))
    .limit(1);

  if (!team) {
    [team] = await db
      .insert(teamsTable)
      .values({ sport, name: abbr, abbreviation: abbr })
      .returning();
  }
  return team;
}

async function fetchSchedule(url: string, retries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await sleep(attempt * 2_000);
      const res = await fetch(url, {
        headers: { "User-Agent": "VibeMeGood/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function syncSportForDate(
  sport: string,
  baseUrl: string,
  dateStr?: string,
): Promise<number> {
  const url = dateStr ? `${baseUrl}?dates=${dateStr}` : baseUrl;
  try {
    const res = await fetchSchedule(url);
    if (!res.ok) return 0;
    const data = await res.json() as any;
    const events: any[] = data?.events ?? [];
    let count = 0;

    for (const event of events) {
      try {
        const competition = event.competitions?.[0];
        if (!competition) continue;

        const startTime = new Date(event.date);
        const status    = competition.status?.type?.name ?? "scheduled";

        const homeComp = competition.competitors?.find((c: any) => c.homeAway === "home");
        const awayComp = competition.competitors?.find((c: any) => c.homeAway === "away");
        if (!homeComp || !awayComp) continue;

        const homeAbbr = homeComp.team?.abbreviation?.toUpperCase() as string | undefined;
        const awayAbbr = awayComp.team?.abbreviation?.toUpperCase() as string | undefined;
        if (!homeAbbr || !awayAbbr) continue;

        const [homeTeam, awayTeam] = await Promise.all([
          findOrCreateTeam(sport, homeAbbr),
          findOrCreateTeam(sport, awayAbbr),
        ]);

        // Scope the duplicate check to the same calendar day so the same
        // two teams can appear on different dates without collision.
        const dayStart = new Date(startTime);
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(startTime);
        dayEnd.setUTCHours(23, 59, 59, 999);

        const [existing] = await db
          .select({ id: gamesTable.id })
          .from(gamesTable)
          .where(and(
            eq(gamesTable.sport, sport),
            eq(gamesTable.homeTeamId, homeTeam.id),
            eq(gamesTable.awayTeamId, awayTeam.id),
            gte(gamesTable.startTime, dayStart),
            lte(gamesTable.startTime, dayEnd),
          ))
          .limit(1);

        const gameStatus = status.toLowerCase().includes("final")
          ? "final"
          : status.toLowerCase().includes("in")
            ? "live"
            : "scheduled";

        if (existing) {
          await db
            .update(gamesTable)
            .set({ status: gameStatus, updatedAt: new Date() })
            .where(eq(gamesTable.id, existing.id));
        } else {
          await db.insert(gamesTable).values({
            sport,
            homeTeamId: homeTeam.id,
            awayTeamId: awayTeam.id,
            startTime,
            status: gameStatus,
          });
        }

        count++;
      } catch (e) {
        logger.warn({ err: e }, "Game upsert failed");
      }
    }
    return count;
  } catch (e) {
    logger.warn({ err: e, sport, dateStr }, "Sport schedule fetch failed");
    return 0;
  }
}

/**
 * Fetch today's MLB probable starters from the free MLB Stats API and patch
 * games.metadata with { homeStartingPitcher, awayStartingPitcher }.
 *
 * Called after every today-only schedule sync so matchup factors in the
 * projection engine (platoon splits, strikeout matchup, pitcher form) can
 * resolve the opposing pitcher for each batter.
 *
 * The MLB Stats API is free and requires no auth:
 *   GET https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher
 */
async function syncMlbProbableStarters(): Promise<number> {
  const today = new Date();
  // Use UTC components so dateStr and the DB day window (setUTCHours below) are
  // derived from the same calendar date regardless of the server's local timezone.
  const dateStr = [
    today.getUTCFullYear(),
    String(today.getUTCMonth() + 1).padStart(2, "0"),
    String(today.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=probablePitcher`;
  let data: any;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "syncMlbProbableStarters: MLB Stats API returned non-200");
      return 0;
    }
    data = await res.json();
  } catch (e) {
    logger.warn({ err: e }, "syncMlbProbableStarters: fetch failed");
    return 0;
  }

  const games: any[] = (data?.dates ?? []).flatMap((d: any) => d.games ?? []);
  if (games.length === 0) return 0;

  // Day window for matching our DB game rows.
  // MLB games are scheduled by US local date, but the latest West Coast night
  // starts (~10 PM PT) fall at ~05:00 UTC the next calendar day. To avoid
  // missing those games we open the window from 00:00 UTC today through
  // 12:00 UTC tomorrow — this covers the full US game day regardless of coast.
  const dayStart = new Date(today);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(today);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  dayEnd.setUTCHours(12, 0, 0, 0);

  // Load today's MLB games from DB indexed by home team abbreviation (upper)
  const mlbTeamRows = await db
    .select({ id: teamsTable.id, abbreviation: teamsTable.abbreviation })
    .from(teamsTable)
    .where(eq(teamsTable.sport, "MLB"));
  const abbr2TeamId = new Map<string, number>(mlbTeamRows.map(t => [t.abbreviation.toUpperCase(), t.id]));

  const dbGames = await db
    .select({ id: gamesTable.id, homeTeamId: gamesTable.homeTeamId, metadata: gamesTable.metadata })
    .from(gamesTable)
    .where(and(
      eq(gamesTable.sport, "MLB"),
      gte(gamesTable.startTime, dayStart),
      lte(gamesTable.startTime, dayEnd),
    ));
  const homeTeamId2GameId = new Map<number, number>(dbGames.map(g => [g.homeTeamId, g.id]));

  let updated = 0;
  for (const g of games) {
    try {
      const homeAbbr = (g.teams?.home?.team?.abbreviation as string | undefined)?.toUpperCase();
      const homeSP   = g.teams?.home?.probablePitcher?.fullName as string | undefined;
      const awaySP   = g.teams?.away?.probablePitcher?.fullName as string | undefined;

      if (!homeAbbr || (!homeSP && !awaySP)) continue;

      const homeTeamId = abbr2TeamId.get(homeAbbr);
      if (!homeTeamId) continue;
      const gameId = homeTeamId2GameId.get(homeTeamId);
      if (!gameId) continue;

      // Merge into existing metadata (preserving any other keys)
      const existing = (dbGames.find(g => g.id === gameId)?.metadata ?? {}) as Record<string, unknown>;
      const newMeta = {
        ...existing,
        ...(homeSP ? { homeStartingPitcher: homeSP } : {}),
        ...(awaySP ? { awayStartingPitcher: awaySP } : {}),
      };

      await db
        .update(gamesTable)
        .set({ metadata: newMeta, updatedAt: new Date() })
        .where(eq(gamesTable.id, gameId));
      updated++;
    } catch (e) {
      logger.warn({ err: e }, "syncMlbProbableStarters: game patch failed");
    }
  }

  logger.info({ updated, date: dateStr }, "syncMlbProbableStarters: done");
  return updated;
}

export async function syncGameSchedule(options?: {
  fromDate?: Date;
  toDate?: Date;
}): Promise<number> {
  // ── Date-range mode ──────────────────────────────────────────────────────────
  if (options?.fromDate && options?.toDate) {
    let total     = 0;
    let dateCount = 0;

    // Use noon UTC to avoid DST boundary issues when incrementing by day
    const current = new Date(options.fromDate);
    current.setUTCHours(12, 0, 0, 0);
    const end = new Date(options.toDate);
    end.setUTCHours(23, 59, 59, 999);

    while (current <= end) {
      const dateStr = formatESPNDate(current);

      const results = await Promise.allSettled(
        Object.entries(SPORT_ENDPOINTS).map(([sport, url]) =>
          syncSportForDate(sport, url, dateStr),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") total += r.value;
      }

      dateCount++;
      if (dateCount % 30 === 0) {
        logger.info({ dateStr, total, dateCount }, "Game schedule history: progress");
      }

      current.setUTCDate(current.getUTCDate() + 1);
      await sleep(100); // ~100 ms between dates to avoid rate limiting
    }

    logger.info({ total, dateCount }, "Game schedule history sync complete");
    return total;
  }

  // ── Today-only mode (original behaviour) ────────────────────────────────────
  let total = 0;
  for (const [sport, url] of Object.entries(SPORT_ENDPOINTS)) {
    total += await syncSportForDate(sport, url);
  }
  logger.info({ total }, "Game schedule sync complete");

  // Patch MLB games with today's probable starters so platoon/K-matchup/
  // pitcher-form factors can resolve the opposing pitcher per batter.
  // Awaited so the route reports success only after metadata is written.
  try {
    const starters = await syncMlbProbableStarters();
    if (starters > 0) logger.info({ starters }, "MLB probable starters patched");
  } catch (e) {
    logger.warn({ err: e }, "syncMlbProbableStarters failed — continuing");
  }

  return total;
}
