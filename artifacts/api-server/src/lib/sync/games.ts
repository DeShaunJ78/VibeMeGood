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

async function syncSportForDate(
  sport: string,
  baseUrl: string,
  dateStr?: string,
): Promise<number> {
  const url = dateStr ? `${baseUrl}?dates=${dateStr}` : baseUrl;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "VibeMeGood/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
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
      await sleep(60); // gentle cadence — ~60 ms between dates
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
  return total;
}
