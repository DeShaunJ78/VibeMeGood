import { db } from "@workspace/db";
import { nflAdvancedMetricsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

const SNAP_COUNTS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;

const PLAYER_STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`;

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
    const batch = dedup(rows.slice(i, i + BATCH).map(r => ({
      playerName:    r["player_display_name"] ?? r["player_name"] ?? r["player"] ?? "",
      team:          r["recent_team"] ?? r["team"] ?? "",
      season,
      week:          int(r["week"]),
      targetShare:   num(r["target_share"]) != null ? String(num(r["target_share"])!) : null,
      airYards:      num(r["receiving_air_yards"]) != null ? String(num(r["receiving_air_yards"])!) : null,
      airYardsShare: num(r["air_yards_share"]) != null ? String(num(r["air_yards_share"])!) : null,
      wopr:          num(r["wopr"]) != null ? String(num(r["wopr"])!) : null,
      racr:          num(r["racr"]) != null ? String(num(r["racr"])!) : null,
      targets:       int(r["targets"]),
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
          targetShare:    sql`excluded.target_share`,
          airYards:       sql`excluded.air_yards`,
          airYardsShare:  sql`excluded.air_yards_share`,
          wopr:           sql`excluded.wopr`,
          racr:           sql`excluded.racr`,
          targets:        sql`excluded.targets`,
          computedAt:     sql`now()`,
        },
      });
    upserted += batch.length;
  }
  return upserted;
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

  return totalUpserted;
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
