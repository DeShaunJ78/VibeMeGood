import { db } from "@workspace/db";
import {
  gamesTable, teamsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";

const SPORT_ENDPOINTS: Record<string, string> = {
  NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  WNBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
  NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
};

export async function syncGameSchedule(): Promise<number> {
  let total = 0;

  for (const [sport, url] of Object.entries(SPORT_ENDPOINTS)) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "VibeMeGood/1.0" },
      });
      if (!res.ok) continue;
      const data = await res.json() as any;

      const events = data?.events ?? [];

      for (const event of events) {
        try {
          const competition = event.competitions?.[0];
          if (!competition) continue;

          const startTime = new Date(event.date);
          const status = competition.status?.type?.name ?? "scheduled";

          const homeComp = competition.competitors?.find(
            (c: any) => c.homeAway === "home",
          );
          const awayComp = competition.competitors?.find(
            (c: any) => c.homeAway === "away",
          );

          if (!homeComp || !awayComp) continue;

          const homeAbbr = homeComp.team?.abbreviation?.toUpperCase();
          const awayAbbr = awayComp.team?.abbreviation?.toUpperCase();

          if (!homeAbbr || !awayAbbr) continue;

          const findOrCreateTeam = async (abbr: string) => {
            let [team] = await db
              .select()
              .from(teamsTable)
              .where(and(
                eq(teamsTable.abbreviation, abbr),
                eq(teamsTable.sport, sport),
              ))
              .limit(1);

            if (!team) {
              [team] = await db.insert(teamsTable).values({
                sport,
                name: abbr,
                abbreviation: abbr,
              }).returning();
            }
            return team;
          };

          const homeTeam = await findOrCreateTeam(homeAbbr);
          const awayTeam = await findOrCreateTeam(awayAbbr);

          const [existing] = await db
            .select()
            .from(gamesTable)
            .where(and(
              eq(gamesTable.sport, sport),
              eq(gamesTable.homeTeamId, homeTeam.id),
              eq(gamesTable.awayTeamId, awayTeam.id),
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

          total++;
        } catch (e) {
          logger.warn({ err: e }, "Game upsert failed");
        }
      }
    } catch (e) {
      logger.warn({ err: e, sport }, "Game schedule sync failed");
    }
  }

  logger.info({ total }, "Game schedule sync complete");
  return total;
}
