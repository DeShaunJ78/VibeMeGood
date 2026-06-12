/**
 * NHL Player Context Sync
 *
 * Fetches per-skater season context from the free NHL Stats API:
 *   - Time on ice (TOI) per game
 *   - Power-play TOI per game → infer PP unit (1st / 2nd / none)
 *   - Corsi For / 60 (shot-attempt differential)
 *   - Fenwick For / 60 (unblocked shot-attempt differential)
 *
 * Matches NHL API players to our players table by case-insensitive full name,
 * then upserts into nhl_player_context (unique on player_id).
 *
 * Data sources (free, no auth required):
 *   Summary:          https://api.nhle.com/stats/rest/en/skater/summary
 *   Puck Possessions: https://api.nhle.com/stats/rest/en/skater/puckPossessions
 */

import { db } from "@workspace/db";
import { nhlPlayerContextTable, playersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../logger";

const NHL_API_BASE   = "https://api.nhle.com/stats/rest/en/skater";
const SEASON_ID      = "20242025";
const GAME_TYPE_ID   = "2";  // regular season
const FETCH_LIMIT    = 500;
const FETCH_TIMEOUT  = 20_000;

interface NhlSummaryRow {
  playerId:          number;
  skaterFullName:    string;
  timeOnIcePerGame:  number;   // seconds/game
  ppTimeOnIcePerGame: number;  // seconds/game
  gamesPlayed?:      number;
}

interface NhlPossessionRow {
  playerId:     number;
  timeOnIce:    number;   // total TOI in seconds for the season
  satFor:       number;   // Corsi For (season total)
  uSatFor:      number;   // Fenwick For = unblocked (season total)
}

async function fetchNhlJson(report: string): Promise<Record<string, unknown>[]> {
  const url = `${NHL_API_BASE}/${report}?reportType=season&seasonId=${SEASON_ID}&gameTypeId=${GAME_TYPE_ID}&limit=${FETCH_LIMIT}&start=0`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`NHL API ${report} returned HTTP ${res.status}`);
    const json = await res.json() as { data: Record<string, unknown>[] };
    if (!Array.isArray(json?.data)) throw new Error(`NHL API ${report}: unexpected response shape`);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Infer PP unit from PP TOI per game (in minutes).
 *  ≥ 3.0 min/game → 1st unit
 *  ≥ 1.0 min/game → 2nd unit
 *  otherwise       → not on PP (null)
 */
function inferPpUnit(ppToiMin: number): number | null {
  if (ppToiMin >= 3.0) return 1;
  if (ppToiMin >= 1.0) return 2;
  return null;
}

export async function syncNhlPlayerContext(): Promise<number> {
  // ── 1. Fetch both endpoints in parallel ────────────────────────────────────
  const [summaryRaw, possessionRaw] = await Promise.all([
    fetchNhlJson("summary").catch((err) => {
      logger.warn({ err }, "syncNhlPlayerContext: summary fetch failed — skipping");
      return [] as Record<string, unknown>[];
    }),
    fetchNhlJson("puckPossessions").catch((err) => {
      logger.warn({ err }, "syncNhlPlayerContext: puckPossessions fetch failed — Corsi will be null");
      return [] as Record<string, unknown>[];
    }),
  ]);

  // ── 2. Parse summary rows ─────────────────────────────────────────────────
  const summaryMap = new Map<number, NhlSummaryRow>();
  for (const row of summaryRaw) {
    const id  = row.playerId as number;
    const toi = row.timeOnIcePerGame as number;
    const ppToi = row.ppTimeOnIcePerGame as number;
    if (typeof id !== "number" || typeof toi !== "number") continue;
    summaryMap.set(id, {
      playerId:           id,
      skaterFullName:     (row.skaterFullName as string) ?? "",
      timeOnIcePerGame:   toi,
      ppTimeOnIcePerGame: ppToi ?? 0,
      gamesPlayed:        (row.gamesPlayed as number | undefined),
    });
  }

  // ── 3. Parse possession rows (Corsi/Fenwick) ──────────────────────────────
  const possessionMap = new Map<number, NhlPossessionRow>();
  for (const row of possessionRaw) {
    const id  = row.playerId as number;
    const toi = row.timeOnIce as number;
    const sf  = row.satFor   as number;
    const uf  = row.uSatFor  as number;
    if (typeof id !== "number") continue;
    possessionMap.set(id, {
      playerId:  id,
      timeOnIce: toi ?? 0,
      satFor:    sf  ?? 0,
      uSatFor:   uf  ?? 0,
    });
  }

  if (summaryMap.size === 0) {
    logger.warn("syncNhlPlayerContext: no summary rows parsed — nothing to upsert");
    return 0;
  }

  // ── 4. Fetch our NHL players (name-match from DB) ─────────────────────────
  const dbPlayers = await db
    .select({ id: playersTable.id, fullName: playersTable.fullName })
    .from(playersTable)
    .where(eq(playersTable.sport, "NHL"));

  const nameToDbId = new Map<string, number>();
  for (const p of dbPlayers) {
    nameToDbId.set(p.fullName.toLowerCase(), p.id);
  }

  // ── 5. Build upsert payloads ──────────────────────────────────────────────
  type UpsertRow = typeof nhlPlayerContextTable.$inferInsert;
  const payloads: UpsertRow[] = [];

  for (const [nhlId, summary] of summaryMap) {
    const dbPlayerId = nameToDbId.get(summary.skaterFullName.toLowerCase());
    if (!dbPlayerId) continue;   // not in our player roster → skip

    const toiMinPerGame = summary.timeOnIcePerGame / 60;   // sec → min
    const ppToiMinPerGame = summary.ppTimeOnIcePerGame / 60;
    const ppUnit = inferPpUnit(ppToiMinPerGame);

    // Corsi / Fenwick per 60 from possession data
    let corsiFor60: number | null = null;
    let fenwickFor60: number | null = null;

    const poss = possessionMap.get(nhlId);
    if (poss && poss.timeOnIce > 0) {
      const toiHours = poss.timeOnIce / 3600;
      corsiFor60   = poss.satFor  / toiHours;
      fenwickFor60 = poss.uSatFor / toiHours;
    }

    payloads.push({
      playerId:     dbPlayerId,
      toiPerGame:   toiMinPerGame.toFixed(2),
      ppToiPerGame: ppToiMinPerGame.toFixed(2),
      ppUnit:       ppUnit,
      corsiFor60:   corsiFor60  != null ? corsiFor60.toFixed(2)   : null,
      fenwickFor60: fenwickFor60 != null ? fenwickFor60.toFixed(2) : null,
      xGoalsPer60:  null,
      updatedAt:    new Date(),
    });
  }

  if (payloads.length === 0) {
    logger.info("syncNhlPlayerContext: no matching NHL players in DB — nothing to upsert");
    return 0;
  }

  // ── 6. Bulk upsert (unique on player_id) ──────────────────────────────────
  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < payloads.length; i += BATCH) {
    const slice = payloads.slice(i, i + BATCH);
    await db.insert(nhlPlayerContextTable)
      .values(slice)
      .onConflictDoUpdate({
        target: nhlPlayerContextTable.playerId,
        set: {
          toiPerGame:   sql`excluded.toi_per_game`,
          ppToiPerGame: sql`excluded.pp_toi_per_game`,
          ppUnit:       sql`excluded.pp_unit`,
          corsiFor60:   sql`excluded.corsi_for_60`,
          fenwickFor60: sql`excluded.fenwick_for_60`,
          xGoalsPer60:  sql`excluded.x_goals_per_60`,
          updatedAt:    sql`excluded.updated_at`,
        },
      });
    upserted += slice.length;
  }

  logger.info({ upserted }, "syncNhlPlayerContext: done");
  return upserted;
}
