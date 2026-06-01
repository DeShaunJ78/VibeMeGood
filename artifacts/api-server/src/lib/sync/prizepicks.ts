import { ProxyAgent, fetch as undiciFetch } from "undici";
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

export const PP_PROJECTIONS_URL =
  `${PP_BASE}/projections?per_page=${PER_PAGE}&single_stat=true&include=new_player,league`;

// PP_PROXY_URL accepts one URL or a comma-separated list.
// A random agent is picked each call so load is spread across all IPs and
// a flagged IP doesn't take down the whole sync.
// Accepts two formats per entry (comma-separated list of either):
//   Standard URL:  http://user:pass@host:port
//   Webshare list: host:port:user:pass  (auto-converted)
function normalizeProxyUrl(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const parts = raw.split(":");
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return `http://${user}:${pass}@${host}:${port}`;
  }
  throw new Error(`Unrecognized proxy format: ${raw}`);
}

const proxyAgents: ProxyAgent[] = (process.env.PP_PROXY_URL ?? "")
  .split(",")
  .map(u => u.trim())
  .filter(Boolean)
  .map(u => new ProxyAgent(normalizeProxyUrl(u)));

if (proxyAgents.length > 0) {
  logger.info({ count: proxyAgents.length }, "PP proxy pool ready");
} else {
  logger.warn("PP_PROXY_URL not set — PrizePicks syncs will fail on cloud IPs");
}

function pickAgent(): ProxyAgent | undefined {
  if (proxyAgents.length === 0) return undefined;
  return proxyAgents[Math.floor(Math.random() * proxyAgents.length)];
}

async function fetchPP(url: string): Promise<Response> {
  const delays = [0, 2000, 5000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    const res = await undiciFetch(url, {
      dispatcher: pickAgent(),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://app.prizepicks.com/",
        "Origin": "https://app.prizepicks.com",
      },
    });
    if (res.status !== 429) return res;
    logger.warn({ attempt: i + 1 }, "PP API 429 — retrying");
  }
  throw new Error("PP API rate limited after 3 attempts");
}

// ── Core processing logic ────────────────────────────────────────────────────
// Separated from the fetch step so it can be called by:
//   1. The server-side cron/manual sync (fetchPP → processPpData)
//   2. The browser-import endpoint (user fetches from their home IP → POST raw JSON here)
export async function processPpData(data: { data: any[]; included: any[] }): Promise<number> {
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
        await db.update(ppLinesTable)
          .set({
            isActive: true,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
            ...(gameId ? { gameId } : {}),
          })
          .where(eq(ppLinesTable.id, existing.id));
      } else {
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

// ── Server-side sync (cron + manual "PrizePicks Lines" button) ───────────────
export async function syncPpLines(): Promise<number> {
  const res = await fetchPP(PP_PROJECTIONS_URL);
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    logger.error({ status: res.status, body: body.slice(0, 500) }, "PrizePicks fetch failed");
    throw new Error(`PrizePicks API error: ${res.status}`);
  }
  const data = await res.json() as { data: any[]; included: any[] };
  return processPpData(data);
}
