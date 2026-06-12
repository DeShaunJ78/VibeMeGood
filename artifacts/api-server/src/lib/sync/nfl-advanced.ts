import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { db } from "@workspace/db";
import { nflAdvancedMetricsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

const SNAP_COUNTS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;

const PLAYER_STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`;

/** nflverse play-by-play (gzipped CSV) — source of true red-zone target/carry counts. */
const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const result: Array<Record<string, string>> = [];
  for (let li = 1; li < lines.length; li++) {
    const values = parseCSVLine(lines[li]);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    result.push(row);
  }
  return result;
}

async function downloadCSV(url: string): Promise<Array<Record<string, string>>> {
  const res = await fetch(url, {
    headers: { "User-Agent": "PropEdge/1.0 nflverse-ingest" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const text = await res.text();
  return parseCSV(text);
}

function num(v: string | undefined): number | null {
  if (!v || v === "NA" || v === "NaN" || v === "Inf" || v === "-Inf" || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) || !isFinite(n) ? null : n;
}

function int(v: string | undefined): number | null {
  if (!v || v === "NA" || v === "") return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

export interface NflIngestResult {
  season: number;
  snapRowsUpserted: number;
  statsRowsUpserted: number;
}

function dedup<T extends { playerName: string; team: string; season: number; week: number | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(r => {
    const key = `${r.playerName}|${r.team}|${r.season}|${r.week}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function ingestSnapCounts(season: number): Promise<number> {
  const rows = await downloadCSV(SNAP_COUNTS_URL(season));
  logger.info({ season, rowCount: rows.length }, "NFL snap counts downloaded");

  let upserted = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = dedup(rows.slice(i, i + BATCH).map(r => ({
      playerName:  r["player"] ?? r["player_name"] ?? "",
      team:        r["team"] ?? "",
      position:    r["position"] ?? null,
      season,
      week:        int(r["week"]),
      snapCount:   int(r["offense_snaps"]),
      snapPct:     num(r["offense_pct"]) != null ? String(num(r["offense_pct"])!) : null,
    })).filter(r => r.playerName && r.team));

    if (batch.length === 0) continue;

    await db.insert(nflAdvancedMetricsTable)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          nflAdvancedMetricsTable.playerName,
          nflAdvancedMetricsTable.team,
          nflAdvancedMetricsTable.season,
          nflAdvancedMetricsTable.week,
        ],
        set: {
          position:    sql`excluded.position`,
          snapCount:   sql`excluded.snap_count`,
          snapPct:     sql`excluded.snap_pct`,
          computedAt:  sql`now()`,
        },
      });
    upserted += batch.length;
  }
  return upserted;
}

async function ingestPlayerStats(season: number): Promise<number> {
  const rows = await downloadCSV(PLAYER_STATS_URL(season));
  logger.info({ season, rowCount: rows.length }, "NFL player stats downloaded");

  let upserted = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = dedup(rows.slice(i, i + BATCH).map(r => {
      const ayNum  = num(r["receiving_air_yards"]);
      const tgtNum = int(r["targets"]);
      const aDotVal = ayNum != null && tgtNum != null && tgtNum > 0
        ? ayNum / tgtNum : null;
      return {
        playerName:    r["player_display_name"] ?? r["player_name"] ?? r["player"] ?? "",
        team:          r["recent_team"] ?? r["team"] ?? "",
        season,
        week:          int(r["week"]),
        targetShare:   num(r["target_share"])   != null ? String(num(r["target_share"])!)   : null,
        airYards:      ayNum  != null ? String(ayNum)  : null,
        airYardsShare: num(r["air_yards_share"]) != null ? String(num(r["air_yards_share"])!) : null,
        wopr:          num(r["wopr"])  != null ? String(num(r["wopr"])!)  : null,
        racr:          num(r["racr"])  != null ? String(num(r["racr"])!)  : null,
        targets:       tgtNum,
        aDot:          aDotVal != null ? String(aDotVal) : null,
      };
    }).filter(r => r.playerName && r.team));

    if (batch.length === 0) continue;

    await db.insert(nflAdvancedMetricsTable)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          nflAdvancedMetricsTable.playerName,
          nflAdvancedMetricsTable.team,
          nflAdvancedMetricsTable.season,
          nflAdvancedMetricsTable.week,
        ],
        set: {
          targetShare:   sql`excluded.target_share`,
          airYards:      sql`excluded.air_yards`,
          airYardsShare: sql`excluded.air_yards_share`,
          wopr:          sql`excluded.wopr`,
          racr:          sql`excluded.racr`,
          targets:       sql`excluded.targets`,
          aDot:          sql`excluded.a_dot`,
          computedAt:    sql`now()`,
        },
      });
    upserted += batch.length;
  }
  return upserted;
}

/**
 * Extract the last name from a PBP-format player name ("T.Kelce" → "Kelce").
 * Returns null when the name doesn't match the expected "F.Lastname" pattern.
 */
function pbpLastName(pbpName: string): string | null {
  // Handles: "T.Kelce", "Ja'Marr.Chase" (two-part first names), "D.J.Moore" (dot in last)
  const m = pbpName.match(/^[A-Z][a-zA-Z'.]*\.([A-Za-z''-]+(?:-[A-Za-z''-]+)*)$/);
  return m ? m[1] : null;
}

/**
 * Stream-parse the nflverse play-by-play gzip CSV for a season.
 * Filters to red-zone plays (yardline_100 ≤ 20) and derives true per-player
 * red-zone target share (receivers) and carry share (rushers) as:
 *   player_rz_events / team_rz_events_that_week
 *
 * Upserts computed shares into nfl_advanced_metrics rows that were already
 * created by ingestPlayerStats, matching on (season, week, team, last name).
 */
async function ingestRedZoneFromPBP(season: number): Promise<number> {
  const url = PBP_URL(season);
  const res = await fetch(url, {
    headers: { "User-Agent": "PropEdge/1.0 nflverse-ingest" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    logger.warn({ season, status: res.status }, "PBP download unavailable — skipping red zone ingest");
    return 0;
  }

  // Stream-decompress line-by-line to avoid loading 500 MB+ uncompressed into memory.
  const gunzip = createGunzip();
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.pipe(gunzip);

  // (team|week) → totals
  const teamRZ = new Map<string, { targets: number; carries: number }>();
  // (pbpName|team|week) → player counts
  const playerRZ = new Map<string, { name: string; team: string; week: number; targets: number; carries: number }>();

  let headers: string[] | null = null;
  let remainder = "";

  const processLine = (line: string) => {
    if (!line.trim()) return;
    if (!headers) { headers = parseCSVLine(line); return; }
    const vals = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });

    const yl = num(row["yardline_100"]);
    if (yl == null || yl > 20) return;

    const week = int(row["week"]);
    const team = row["posteam"] ?? "";
    if (!week || !team) return;

    const teamKey = `${team}|${week}`;
    const tot = teamRZ.get(teamKey) ?? { targets: 0, carries: 0 };

    if (row["pass_attempt"] === "1") {
      const name = (row["receiver_player_name"] ?? "").trim();
      if (name) {
        const pk = `${name}|${team}|${week}`;
        const pc = playerRZ.get(pk) ?? { name, team, week, targets: 0, carries: 0 };
        pc.targets++;
        playerRZ.set(pk, pc);
      }
      tot.targets++;
    }

    if (row["rush_attempt"] === "1") {
      const name = (row["rusher_player_name"] ?? "").trim();
      if (name) {
        const pk = `${name}|${team}|${week}`;
        const pc = playerRZ.get(pk) ?? { name, team, week, targets: 0, carries: 0 };
        pc.carries++;
        playerRZ.set(pk, pc);
      }
      tot.carries++;
    }

    teamRZ.set(teamKey, tot);
  };

  for await (const chunk of gunzip) {
    const text = remainder + (chunk as Buffer).toString("utf8");
    const lines = text.split("\n");
    remainder = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }
  if (remainder) processLine(remainder);

  logger.info({ season, players: playerRZ.size, teams: teamRZ.size }, "PBP red zone aggregation complete");

  // Upsert computed red zone shares into existing rows.
  // PBP names are "F.Lastname"; DB player_name is the full display name.
  // Match on season + week + team + last-name suffix for robustness.
  const updates = [...playerRZ.values()];
  let updated = 0;
  const BATCH = 50;

  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    await Promise.all(slice.map(async (player) => {
      const totals = teamRZ.get(`${player.team}|${player.week}`);
      if (!totals) return;
      const rzTarget = totals.targets > 0 ? player.targets / totals.targets : null;
      const rzCarry  = totals.carries > 0 ? player.carries / totals.carries : null;
      if (rzTarget === null && rzCarry === null) return;

      const lastName = pbpLastName(player.name);
      if (!lastName) return;

      const setData: { redZoneTargetShare?: string; redZoneCarryShare?: string } = {};
      if (rzTarget != null) setData.redZoneTargetShare = String(rzTarget);
      if (rzCarry  != null) setData.redZoneCarryShare  = String(rzCarry);

      const affected = await db.update(nflAdvancedMetricsTable)
        .set(setData)
        .where(
          sql`season = ${season}
              and week = ${player.week}
              and team = ${player.team}
              and lower(player_name) like '% ' || lower(${lastName})`,
        )
        .returning({ id: nflAdvancedMetricsTable.id });
      updated += affected.length;
    }));
  }

  logger.info({ season, updated }, "Red zone PBP shares upserted");
  return updated;
}

export async function syncNflAdvancedMetrics(): Promise<number> {
  const seasons = [2023, 2024];
  let totalUpserted = 0;

  for (const season of seasons) {
    const snapRows  = await ingestSnapCounts(season);
    const statsRows = await ingestPlayerStats(season);
    totalUpserted += snapRows + statsRows;
    logger.info({ season, snapRows, statsRows }, "NFL advanced metrics season done");
  }

  // Ingest true red zone shares from PBP (most recent complete season).
  // nflverse player_stats weekly CSV has no red zone columns — the PBP is the
  // authoritative source for yardline_100-filtered target/carry counts.
  try {
    const rzRows = await ingestRedZoneFromPBP(2024);
    totalUpserted += rzRows;
    logger.info({ season: 2024, rzRows }, "Red zone PBP ingest done");
  } catch (err) {
    logger.warn({ err }, "Red zone PBP ingest failed — red zone shares will remain stale (non-critical)");
  }

  return totalUpserted;
}

export interface NflUsage {
  snapPct: number | null;
  targetShare: number | null;
  airYardsShare: number | null;
  wopr: number | null;
  aDot: number | null;
  redZoneTargetShare: number | null;
  redZoneCarryShare: number | null;
}

/**
 * Batch-load the most recent (season, week) advanced usage row for each player name.
 * Returns a Map keyed by lower-cased player name. Avoids N+1 lookups in the
 * projection loop.
 */
export async function getNflUsageMap(playerNames: string[]): Promise<Map<string, NflUsage>> {
  const result = new Map<string, NflUsage>();
  if (playerNames.length === 0) return result;

  const lowered = [...new Set(playerNames.map((n) => n.toLowerCase()))];

  // DISTINCT ON keeps the latest row per player by (season desc, week desc).
  const rows = await db
    .select({
      playerName:         nflAdvancedMetricsTable.playerName,
      snapPct:            nflAdvancedMetricsTable.snapPct,
      targetShare:        nflAdvancedMetricsTable.targetShare,
      airYardsShare:      nflAdvancedMetricsTable.airYardsShare,
      wopr:               nflAdvancedMetricsTable.wopr,
      aDot:               nflAdvancedMetricsTable.aDot,
      redZoneTargetShare: nflAdvancedMetricsTable.redZoneTargetShare,
      redZoneCarryShare:  nflAdvancedMetricsTable.redZoneCarryShare,
    })
    .from(nflAdvancedMetricsTable)
    .where(sql`lower(player_name) = ANY(ARRAY[${sql.join(lowered.map((n) => sql`${n}`), sql`, `)}]) and week is not null`)
    .orderBy(sql`lower(player_name), season desc, week desc`);

  for (const r of rows) {
    const key = r.playerName.toLowerCase();
    if (result.has(key)) continue; // first row per name is the latest
    const pf = (v: unknown) => v != null ? parseFloat(String(v)) : null;
    result.set(key, {
      snapPct:            pf(r.snapPct),
      targetShare:        pf(r.targetShare),
      airYardsShare:      pf(r.airYardsShare),
      wopr:               pf(r.wopr),
      aDot:               pf(r.aDot),
      redZoneTargetShare: pf(r.redZoneTargetShare),
      redZoneCarryShare:  pf(r.redZoneCarryShare),
    });
  }
  return result;
}

export async function getSnapPctAdjustment(playerName: string): Promise<number> {
  const [row] = await db
    .select({ snapPct: nflAdvancedMetricsTable.snapPct })
    .from(nflAdvancedMetricsTable)
    .where(
      sql`lower(player_name) = lower(${playerName}) and week is not null and snap_pct is not null`,
    )
    .orderBy(sql`season desc, week desc`)
    .limit(1);

  if (!row?.snapPct) return 1.0;
  const pct = parseFloat(row.snapPct.toString());
  if (pct >= 0.80) return 1.0;
  if (pct >= 0.60) return 0.97;
  return 0.92;
}
