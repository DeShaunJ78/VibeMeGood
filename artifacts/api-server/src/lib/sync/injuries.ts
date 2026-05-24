import { db } from "@workspace/db";
import { playersTable, injuriesTable, alertsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import { broadcast } from "../sse";

const SPORT_URLS: Record<string, string> = {
  NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
  MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries",
  NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries",
  NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries",
  WNBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/injuries",
};

export async function syncInjuries(): Promise<number> {
  let processed = 0;

  for (const [sport, url] of Object.entries(SPORT_URLS)) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn({ sport, status: res.status }, "ESPN injury fetch non-OK");
        continue;
      }
      const data = await res.json() as { injuries?: any[] };

      for (const item of (data.injuries ?? [])) {
        try {
          const athleteName = (item.athlete?.displayName ?? item.athlete?.fullName) as string | undefined;
          if (!athleteName) continue;

          const rawStatus = (item.status ?? "") as string;
          const normalizedStatus = rawStatus.toLowerCase().includes("out") ? "out"
            : rawStatus.toLowerCase().includes("doubt") ? "doubtful"
            : rawStatus.toLowerCase().includes("question") ? "questionable"
            : rawStatus.toLowerCase().includes("probable") ? "probable"
            : rawStatus.toLowerCase().includes("day") ? "gtd"
            : "active";

          const note = ((item.detail ?? item.longComment ?? item.shortComment ?? "") as string).slice(0, 500);
          const reportedAt = item.date ? new Date(item.date as string) : new Date();

          const [player] = await db.select({ id: playersTable.id })
            .from(playersTable)
            .where(and(eq(playersTable.fullName, athleteName), eq(playersTable.sport, sport)))
            .limit(1);
          if (!player) continue;

          const [existing] = await db.select({ id: injuriesTable.id })
            .from(injuriesTable)
            .where(eq(injuriesTable.playerId, player.id))
            .limit(1);

          if (existing) {
            await db.update(injuriesTable)
              .set({ status: normalizedStatus, note, source: "espn", reportedAt })
              .where(eq(injuriesTable.id, existing.id));
          } else {
            await db.insert(injuriesTable).values({
              playerId: player.id,
              sport,
              status: normalizedStatus,
              note,
              source: "espn",
              reportedAt,
            });
          }

          if (normalizedStatus === "out" || normalizedStatus === "questionable" || normalizedStatus === "gtd") {
            broadcast("injury_alert", {
              playerName: athleteName,
              status: normalizedStatus.toUpperCase(),
              message: `${athleteName} is listed ${normalizedStatus.toUpperCase()} — check your active entries`,
              severity: normalizedStatus === "out" ? "critical" : "warning",
            });
            await db.insert(alertsTable).values({
              type: "injury_update",
              severity: normalizedStatus === "out" ? "warning" : "info",
              title: `${athleteName} — ${normalizedStatus.toUpperCase()}`,
              message: `${athleteName} is listed ${normalizedStatus.toUpperCase()} per ESPN.`,
            });
          }

          processed++;
        } catch (e) {
          logger.warn({ err: e }, "Error processing ESPN injury item");
        }
      }
    } catch (e) {
      logger.error({ err: e, sport }, "ESPN injury fetch error");
    }
  }

  return processed;
}
