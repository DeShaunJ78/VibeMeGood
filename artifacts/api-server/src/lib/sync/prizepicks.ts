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
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type PpNorm = {
  sport: string;
  teamAbbr: string;
  playerName: string;
  ppPlayerId: string | undefined;
  statType: string;
  lineValue: number;
  lineType: string;
  imageUrl: string | null;
  position: string | null;
};

// Processes a PP projections payload. Previously this did ~6 sequential DB
// round-trips PER projection (team/player/game/line lookups + writes), which on a
// full per_page=25000 feed meant tens of thousands of serial queries and ran for
// minutes. This version preloads every lookup table into memory once and batches
// all inserts/updates, turning O(rows) round-trips into a small constant.
export async function processPpData(data: { data: any[]; included: any[] }): Promise<number> {
  const playerAttrMap: Record<string, Record<string, unknown>> = {};
  const leagueMap: Record<string, Record<string, unknown>> = {};
  for (const inc of (data.included || [])) {
    if (inc.type === "new_player") playerAttrMap[inc.id] = inc.attributes;
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

  // ── Phase 1: normalize projections; collect the unique teams & players needed ──
  const norms: PpNorm[] = [];
  const neededTeams = new Map<string, { sport: string; abbr: string }>();
  const neededPlayers = new Map<string, PpNorm>();

  for (const proj of (data.data || [])) {
    const pAttr = playerAttrMap[proj.relationships?.new_player?.data?.id] || {};
    const lAttr = leagueMap[proj.relationships?.league?.data?.id] || {};
    const lineValue = parseFloat(proj.attributes?.line_score as string);
    if (isNaN(lineValue)) continue;

    // PrizePicks exposes the tier as `odds_type` (standard | goblin | demon).
    // There is NO `line_type` field on the API.
    const lineType = ((proj.attributes?.odds_type as string) || "standard").toLowerCase();
    const statType = proj.attributes?.stat_type as string;
    // statType is NOT NULL on pp_lines — drop rows missing it so one bad
    // projection can't abort the whole batched insert.
    if (!statType) continue;
    const sport = (lAttr.name as string) || (pAttr.sport as string) || "Unknown";
    seenSports.add(sport);
    const playerName = (pAttr.name as string) || "Unknown";
    const teamAbbr = ((pAttr.team as string) || "").toUpperCase();
    const imageUrl = (pAttr.image_url as string | undefined) ?? null;
    const position = ((pAttr.position as string | undefined) ?? "").trim() || null;

    const norm: PpNorm = {
      sport, teamAbbr, playerName,
      ppPlayerId: proj.relationships?.new_player?.data?.id,
      statType, lineValue, lineType, imageUrl, position,
    };
    norms.push(norm);
    if (teamAbbr) neededTeams.set(`${sport}|${teamAbbr}`, { sport, abbr: teamAbbr });
    neededPlayers.set(`${sport}|${playerName}`, norm);
  }

  // ── Phase 2: resolve teams (preload all, batch-insert the missing) ──
  const teamMap = new Map<string, number>(); // `${sport}|${abbr}` -> id
  {
    const existing = await db
      .select({ id: teamsTable.id, sport: teamsTable.sport, abbreviation: teamsTable.abbreviation })
      .from(teamsTable);
    for (const t of existing) teamMap.set(`${t.sport}|${t.abbreviation}`, t.id);
    const toInsert = [...neededTeams.values()]
      .filter(t => !teamMap.has(`${t.sport}|${t.abbr}`))
      .map(t => ({ sport: t.sport, name: t.abbr, abbreviation: t.abbr }));
    for (const batch of chunk(toInsert, 500)) {
      const inserted = await db.insert(teamsTable).values(batch)
        .returning({ id: teamsTable.id, sport: teamsTable.sport, abbreviation: teamsTable.abbreviation });
      for (const t of inserted) teamMap.set(`${t.sport}|${t.abbreviation}`, t.id);
    }
  }

  // ── Phase 3: resolve players (preload all, batch-insert new, update changed) ──
  const playerIdByKey = new Map<string, number>(); // `${sport}|${fullName}` -> id
  {
    const existing = await db
      .select({
        id: playersTable.id, sport: playersTable.sport, fullName: playersTable.fullName,
        teamId: playersTable.teamId, imageUrl: playersTable.imageUrl, position: playersTable.position,
      })
      .from(playersTable);
    const existingByKey = new Map<string, typeof existing[number]>();
    for (const p of existing) existingByKey.set(`${p.sport}|${p.fullName}`, p);

    const toInsert: (typeof playersTable.$inferInsert)[] = [];
    const toUpdate: { id: number; updates: Record<string, unknown> }[] = [];
    for (const [key, n] of neededPlayers) {
      const teamId = n.teamAbbr ? (teamMap.get(`${n.sport}|${n.teamAbbr}`) ?? null) : null;
      const ex = existingByKey.get(key);
      if (!ex) {
        const parts = n.playerName.split(" ");
        toInsert.push({
          sport: n.sport,
          fullName: n.playerName,
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" ") || "",
          teamId,
          imageUrl: n.imageUrl,
          position: n.position,
          status: "active",
          externalIds: { pp_id: n.ppPlayerId },
        });
      } else {
        playerIdByKey.set(key, ex.id);
        const updates: Record<string, unknown> = {};
        if (teamId && ex.teamId !== teamId) updates.teamId = teamId;
        if (n.imageUrl && ex.imageUrl !== n.imageUrl) updates.imageUrl = n.imageUrl;
        if (n.position && ex.position !== n.position) updates.position = n.position;
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          toUpdate.push({ id: ex.id, updates });
        }
      }
    }
    for (const batch of chunk(toInsert, 500)) {
      const inserted = await db.insert(playersTable).values(batch)
        .returning({ id: playersTable.id, sport: playersTable.sport, fullName: playersTable.fullName });
      for (const p of inserted) playerIdByKey.set(`${p.sport}|${p.fullName}`, p.id);
    }
    for (const u of toUpdate) {
      await db.update(playersTable).set(u.updates).where(eq(playersTable.id, u.id));
    }
  }

  // ── Phase 4: today's games, keyed by `${sport}|${teamId}` ──
  const gameMap = new Map<string, number>();
  {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    const games = await db
      .select({
        id: gamesTable.id, sport: gamesTable.sport,
        homeTeamId: gamesTable.homeTeamId, awayTeamId: gamesTable.awayTeamId,
      })
      .from(gamesTable)
      .where(and(gte(gamesTable.startTime, dayStart), lte(gamesTable.startTime, dayEnd)));
    for (const g of games) {
      if (g.homeTeamId != null) gameMap.set(`${g.sport}|${g.homeTeamId}`, g.id);
      if (g.awayTeamId != null) gameMap.set(`${g.sport}|${g.awayTeamId}`, g.id);
    }
  }

  // ── Phase 5: lines (preload all, partition into batch update vs batch insert) ──
  const normVal = (v: number | string) => Number(v).toString();
  const existingLines = new Map<string, number>(); // `${playerId}|${stat}|${val}|${type}` -> id
  {
    const rows = await db
      .select({
        id: ppLinesTable.id, playerId: ppLinesTable.playerId, statType: ppLinesTable.statType,
        lineValue: ppLinesTable.lineValue, lineType: ppLinesTable.lineType,
      })
      .from(ppLinesTable);
    for (const l of rows) {
      existingLines.set(`${l.playerId}|${l.statType}|${normVal(l.lineValue)}|${l.lineType}`, l.id);
    }
  }

  const updateIds: number[] = [];
  const updateIdsByGame = new Map<number, number[]>();
  const linesToInsert: { record: PpNorm; playerId: number; gameId: number | null }[] = [];
  const queuedNew = new Set<string>();
  let processed = 0;

  for (const n of norms) {
    const pid = playerIdByKey.get(`${n.sport}|${n.playerName}`);
    if (pid == null) continue;
    const teamId = n.teamAbbr ? (teamMap.get(`${n.sport}|${n.teamAbbr}`) ?? null) : null;
    const gameId = teamId != null ? (gameMap.get(`${n.sport}|${teamId}`) ?? null) : null;
    const key = `${pid}|${n.statType}|${normVal(n.lineValue)}|${n.lineType}`;

    const existingId = existingLines.get(key);
    if (existingId != null) {
      updateIds.push(existingId);
      if (gameId != null) {
        const arr = updateIdsByGame.get(gameId) ?? [];
        arr.push(existingId);
        updateIdsByGame.set(gameId, arr);
      }
    } else if (!queuedNew.has(key)) {
      queuedNew.add(key);
      linesToInsert.push({ record: n, playerId: pid, gameId });
    }
    processed++;
  }

  // Refresh existing lines: one bulk update for the common fields...
  const allUpdateIds = [...new Set(updateIds)];
  for (const batch of chunk(allUpdateIds, 1000)) {
    await db.update(ppLinesTable)
      .set({ isActive: true, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(inArray(ppLinesTable.id, batch));
  }
  // ...then one update per distinct game for the few that resolved a game today.
  for (const [gameId, ids] of updateIdsByGame) {
    for (const batch of chunk([...new Set(ids)], 1000)) {
      await db.update(ppLinesTable).set({ gameId }).where(inArray(ppLinesTable.id, batch));
    }
  }

  // Insert new lines + their history rows atomically (a history failure must not
  // leave orphan lines), then fire goblin alerts only after the commit succeeds.
  const goblins: PpNorm[] = [];
  if (linesToInsert.length > 0) {
    await db.transaction(async (tx) => {
      const historyRows: (typeof ppLineHistoryTable.$inferInsert)[] = [];
      for (const batch of chunk(linesToInsert, 500)) {
        const values = batch.map(b => ({
          playerId: b.playerId,
          statType: b.record.statType,
          lineValue: b.record.lineValue.toString(),
          lineType: b.record.lineType,
          gameId: b.gameId,
          directionalityType: "over_under",
          isActive: true,
          openedAt: new Date(),
          lastSyncedAt: new Date(),
        }));
        const inserted = await tx.insert(ppLinesTable).values(values).returning({ id: ppLinesTable.id });
        inserted.forEach((row, i) => {
          const b = batch[i];
          historyRows.push({
            ppLineId: row.id,
            lineValue: b.record.lineValue.toString(),
            lineType: b.record.lineType,
            capturedAt: new Date(),
          });
          if (b.record.lineType === "goblin") goblins.push(b.record);
        });
      }
      for (const batch of chunk(historyRows, 500)) {
        await tx.insert(ppLineHistoryTable).values(batch);
      }
    });
  }
  for (const g of goblins) {
    broadcastNewGoblin(g.playerName, g.statType, g.lineValue, g.sport);
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
