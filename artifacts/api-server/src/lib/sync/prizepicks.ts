import { db } from "@workspace/db";
import {
  ppLinesTable, ppLineHistoryTable, playersTable, teamsTable, gamesTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, lt, gte, lte } from "drizzle-orm";
import { broadcastNewGoblin } from "../sse";
import { logger } from "../logger";

const PP_BASE = process.env.PP_API_BASE || "https://api.prizepicks.com";

export async function syncPpLines(): Promise<number> {
  const res = await fetch(
    `${PP_BASE}/projections?per_page=500&single_stat=true&include=new_player,league`,
    { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) throw new Error(`PrizePicks API error: ${res.status}`);
  const data = await res.json() as {
    data: any[];
    included: any[];
  };

  const playerMap: Record<string, Record<string, unknown>> = {};
  const leagueMap: Record<string, Record<string, unknown>> = {};
  for (const inc of (data.included || [])) {
    if (inc.type === "new_player") playerMap[inc.id] = inc.attributes;
    if (inc.type === "league") leagueMap[inc.id] = inc.attributes;
  }

  let processed = 0;

  for (const proj of (data.data || [])) {
    try {
      const pAttr = playerMap[proj.relationships?.new_player?.data?.id] || {};
      const lAttr = leagueMap[proj.relationships?.league?.data?.id] || {};
      const lineValue = parseFloat(proj.attributes.line_score as string);
      if (isNaN(lineValue)) continue;

      const lineType = ((proj.attributes.line_type as string) || "standard").toLowerCase();
      const statType = proj.attributes.stat_type as string;
      const sport = (lAttr.name as string) || (pAttr.sport as string) || "Unknown";
      const playerName = (pAttr.name as string) || "Unknown";
      const teamAbbr = ((pAttr.team as string) || "").toUpperCase();
      const imageUrl = (pAttr.image_url as string | undefined) ?? null;

      // Upsert team
      let teamId: number | null = null;
      if (teamAbbr) {
        let [team] = await db.select()
          .from(teamsTable)
          .where(and(eq(teamsTable.abbreviation, teamAbbr), eq(teamsTable.sport, sport)))
          .limit(1);
        if (!team) {
          [team] = await db.insert(teamsTable).values({
            sport, name: teamAbbr, abbreviation: teamAbbr,
          }).returning();
        }
        teamId = team.id;
      }

      // Upsert player
      let [player] = await db.select().from(playersTable)
        .where(and(eq(playersTable.fullName, playerName), eq(playersTable.sport, sport)))
        .limit(1);

      if (!player) {
        const parts = playerName.split(" ");
        [player] = await db.insert(playersTable).values({
          sport,
          fullName: playerName,
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" ") || "",
          teamId,
          imageUrl,
          status: "active",
          externalIds: { pp_id: proj.relationships?.new_player?.data?.id },
        }).returning();
      } else {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (teamId && player.teamId !== teamId) updates.teamId = teamId;
        if (imageUrl && player.imageUrl !== imageUrl) updates.imageUrl = imageUrl;
        if (Object.keys(updates).length > 1) {
          await db.update(playersTable).set(updates).where(eq(playersTable.id, player.id));
        }
      }

      // Resolve today's game for this player's team
      let gameId: number | null = null;
      if (teamId) {
        const now = new Date();
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(now);
        dayEnd.setHours(23, 59, 59, 999);

        const [matchingGame] = await db
          .select({ id: gamesTable.id })
          .from(gamesTable)
          .where(and(
            eq(gamesTable.sport, sport),
            gte(gamesTable.startTime, dayStart),
            lte(gamesTable.startTime, dayEnd),
            or(
              eq(gamesTable.homeTeamId, teamId),
              eq(gamesTable.awayTeamId, teamId),
            ),
          ))
          .limit(1);

        gameId = matchingGame?.id ?? null;
      }

      // Check for existing active line
      const [existing] = await db.select().from(ppLinesTable)
        .where(and(
          eq(ppLinesTable.playerId, player.id),
          eq(ppLinesTable.statType, statType),
          eq(ppLinesTable.isActive, true),
        )).limit(1);

      if (existing) {
        if (Number(existing.lineValue) !== lineValue || existing.lineType !== lineType) {
          await db.insert(ppLineHistoryTable).values({
            ppLineId: existing.id,
            lineValue: Number(existing.lineValue).toString(),
            lineType: existing.lineType,
            capturedAt: new Date(),
          });
          await db.update(ppLinesTable)
            .set({ lineValue: lineValue.toString(), lineType, gameId, lastSyncedAt: new Date(), updatedAt: new Date() })
            .where(eq(ppLinesTable.id, existing.id));
        } else {
          // Line unchanged — stamp lastSyncedAt and update gameId if newly resolved
          await db.update(ppLinesTable)
            .set({ lastSyncedAt: new Date(), ...(gameId ? { gameId } : {}) })
            .where(eq(ppLinesTable.id, existing.id));
        }
      } else {
        const [newLine] = await db.insert(ppLinesTable).values({
          playerId: player.id,
          statType,
          lineValue: lineValue.toString(),
          lineType,
          gameId,
          directionalityType: "over_under",
          isActive: true,
          openedAt: new Date(),
          lastSyncedAt: new Date(),
        }).returning();
        await db.insert(ppLineHistoryTable).values({
          ppLineId: newLine.id,
          lineValue: lineValue.toString(),
          lineType,
          capturedAt: new Date(),
        });

        if (lineType === "goblin") {
          broadcastNewGoblin(playerName, statType, lineValue, sport);
        }
      }
      processed++;
    } catch (e) {
      logger.error({ err: e }, "Error processing PP projection");
    }
  }

  // Deactivate lines that weren't seen in this sync (use timestamp, not ID list)
  // Any active line whose lastSyncedAt is more than 1 hour old wasn't in this run
  const deactivationCutoff = new Date(Date.now() - 60 * 60 * 1000);
  const deactivated = await db
    .update(ppLinesTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(
      eq(ppLinesTable.isActive, true),
      or(
        isNull(ppLinesTable.lastSyncedAt),
        lt(ppLinesTable.lastSyncedAt, deactivationCutoff),
      ),
    ))
    .returning({ id: ppLinesTable.id });
  if (deactivated.length > 0) {
    logger.info({ count: deactivated.length }, "Deactivated stale PP lines");
  }

  return processed;
}
