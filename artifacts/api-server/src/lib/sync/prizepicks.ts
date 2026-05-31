import { db } from "@workspace/db";
import {
  ppLinesTable, ppLineHistoryTable, playersTable, teamsTable, gamesTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, lt, gte, lte, count, inArray } from "drizzle-orm";
import { broadcastNewGoblin } from "../sse";
import { logger } from "../logger";

const PP_BASE = process.env.PP_API_BASE || "https://api.prizepicks.com";

// Single-page fetch cap. If a response ever returns this many rows we must assume it
// was truncated (PP handed us a full page with more behind it) and refuse to run
// deactivation, since the missing tail would otherwise be mass-deactivated.
const PER_PAGE = 25000;

async function fetchPP(url: string): Promise<Response> {
  const delays = [0, 1000, 3000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    const res = await fetch(url, {
      headers: { "User-Agent": "VibeMeGood/1.0", "Accept": "application/json" },
    });
    if (res.status !== 429) return res;
    logger.warn({ attempt: i + 1 }, "PP API 429 — retrying");
  }
  throw new Error("PP API rate limited after 3 attempts");
}

export async function syncPpLines(): Promise<number> {
  const res = await fetchPP(
    `${PP_BASE}/projections?per_page=${PER_PAGE}&single_stat=true&include=new_player,league`,
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

  // How many lines are live BEFORE this run — used as a sanity floor so a partial
  // response can't wipe the board.
  const [{ value: activeBefore }] = await db
    .select({ value: count() })
    .from(ppLinesTable)
    .where(eq(ppLinesTable.isActive, true));

  // Sports that actually appeared in THIS response — deactivation is scoped to these.
  const seenSports = new Set<string>();

  let processed = 0;

  for (const proj of (data.data || [])) {
    try {
      const pAttr = playerMap[proj.relationships?.new_player?.data?.id] || {};
      const lAttr = leagueMap[proj.relationships?.league?.data?.id] || {};
      const lineValue = parseFloat(proj.attributes.line_score as string);
      if (isNaN(lineValue)) continue;

      // PrizePicks exposes the tier as `odds_type` (standard | goblin | demon).
      // There is NO `line_type` field on the API — reading it left every row
      // labelled "standard", which collapsed goblin/demon tiers and made same-value
      // standard+demon pairs collide on the upsert key (lines stopped matching PP).
      const lineType = ((proj.attributes.odds_type as string) || "standard").toLowerCase();
      const statType = proj.attributes.stat_type as string;
      const sport = (lAttr.name as string) || (pAttr.sport as string) || "Unknown";
      seenSports.add(sport);
      const playerName = (pAttr.name as string) || "Unknown";
      const teamAbbr = ((pAttr.team as string) || "").toUpperCase();
      const imageUrl = (pAttr.image_url as string | undefined) ?? null;
      const position = ((pAttr.position as string | undefined) ?? "").trim() || null;

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
          position,
          status: "active",
          externalIds: { pp_id: proj.relationships?.new_player?.data?.id },
        }).returning();
      } else {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (teamId && player.teamId !== teamId) updates.teamId = teamId;
        if (imageUrl && player.imageUrl !== imageUrl) updates.imageUrl = imageUrl;
        if (position && player.position !== position) updates.position = position;
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

      // Upsert on (playerId, statType, lineValue, lineType)
      const [existing] = await db
        .select()
        .from(ppLinesTable)
        .where(and(
          eq(ppLinesTable.playerId, player.id),
          eq(ppLinesTable.statType, statType),
          eq(ppLinesTable.lineValue, lineValue.toString()),
          eq(ppLinesTable.lineType, lineType),
        ))
        .limit(1);

      if (existing) {
        // Row exists — update timestamps and gameId only
        await db.update(ppLinesTable)
          .set({
            isActive: true,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
            ...(gameId ? { gameId } : {}),
          })
          .where(eq(ppLinesTable.id, existing.id));
      } else {
        // New tier — insert fresh row
        const [newLine] = await db
          .insert(ppLinesTable)
          .values({
            playerId: player.id,
            statType,
            lineValue: lineValue.toString(),
            lineType,
            gameId,
            directionalityType: "over_under",
            isActive: true,
            openedAt: new Date(),
            lastSyncedAt: new Date(),
          })
          .returning();

        await db.insert(ppLineHistoryTable)
          .values({
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

  // ── Deactivation guard ──────────────────────────────────────────────────────
  // Deactivation removes any active line not refreshed in the last hour. That is only
  // safe on a COMPLETE response — a partial / empty / truncated PP payload would
  // otherwise mass-deactivate live lines across every sport. So we refuse to run it
  // unless the response looks trustworthy, AND we scope it to the sports we actually
  // saw this run (a transient drop of one sport can't deactivate another's lines).
  const totalReturned = (data.data || []).length;
  let skipReason = "";
  if (totalReturned === 0) {
    skipReason = "empty PP response";
  } else if (totalReturned >= PER_PAGE) {
    skipReason = `hit per_page cap (${PER_PAGE}) — response may be truncated`;
  } else if (activeBefore > 0 && processed < Math.floor(activeBefore * 0.25)) {
    skipReason = `processed ${processed} is under 25% of ${activeBefore} active lines — treating as partial`;
  }

  if (skipReason) {
    logger.warn(
      { processed, activeBefore, totalReturned, reason: skipReason },
      "PP sync: skipping deactivation to avoid mass-wiping active lines",
    );
    return processed;
  }

  const deactivationCutoff = new Date(Date.now() - 60 * 60 * 1000);
  const seenSportList = [...seenSports];
  const deactivated = seenSportList.length === 0 ? [] : await db
    .update(ppLinesTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(
      eq(ppLinesTable.isActive, true),
      or(
        isNull(ppLinesTable.lastSyncedAt),
        lt(ppLinesTable.lastSyncedAt, deactivationCutoff),
      ),
      inArray(
        ppLinesTable.playerId,
        db.select({ id: playersTable.id })
          .from(playersTable)
          .where(inArray(playersTable.sport, seenSportList)),
      ),
    ))
    .returning({ id: ppLinesTable.id });
  if (deactivated.length > 0) {
    logger.info({ count: deactivated.length, sports: seenSportList }, "Deactivated stale PP lines");
  }

  return processed;
}
