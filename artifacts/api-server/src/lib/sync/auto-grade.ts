import { db } from "@workspace/db";
import { entryPicksTable, entriesTable, playerGameLogsTable } from "@workspace/db/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
import { statTypeCandidates } from "../stat-type";

// Re-export so existing imports of STAT_TYPE_ALIASES from this module keep working.
export { STAT_TYPE_ALIASES } from "../stat-type";

// ---------------------------------------------------------------------------
// Log-value resolver — tries every candidate form of the stat type so a pick
// stored as "PTS" matches a game log stored as "Points" (and vice-versa).
// ---------------------------------------------------------------------------
function resolveLogValue(
  logMap: Map<string, number>,
  playerId: number,
  date: string,
  statType: string,
): number | undefined {
  for (const candidate of statTypeCandidates(statType)) {
    const v = logMap.get(`${playerId}|${date}|${candidate}`);
    if (v != null) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Core grading job — called by both the HTTP route and the nightly cron (#92)
// ---------------------------------------------------------------------------
export async function gradePicksJob(): Promise<number> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const pendingPicks = await db
    .select({
      pickId:    entryPicksTable.id,
      entryId:   entryPicksTable.entryId,
      playerId:  entryPicksTable.playerId,
      statType:  entryPicksTable.statType,
      direction: entryPicksTable.direction,
      lineValue: entryPicksTable.lineValue,
    })
    .from(entryPicksTable)
    .where(and(
      eq(entryPicksTable.result, "pending"),
      isNotNull(entryPicksTable.playerId),
    ));

  if (pendingPicks.length === 0) return 0;

  const entryIds = [...new Set(pendingPicks.map(p => p.entryId))];
  const entryRows = await db
    .select({ id: entriesTable.id, entryDate: entriesTable.entryDate })
    .from(entriesTable)
    .where(inArray(entriesTable.id, entryIds));
  const entryDateMap = new Map(entryRows.map(e => [e.id, e.entryDate]));

  const pastPicks = pendingPicks.filter(p => {
    const d = entryDateMap.get(p.entryId);
    return d != null && String(d) < todayStr;
  });

  if (pastPicks.length === 0) return 0;

  const playerIds = [...new Set(pastPicks.map(p => p.playerId as number))];
  const dates     = [...new Set(pastPicks.map(p => String(entryDateMap.get(p.entryId)!)))];

  const gameLogs = await db
    .select({
      playerId: playerGameLogsTable.playerId,
      gameDate: playerGameLogsTable.gameDate,
      statType: playerGameLogsTable.statType,
      value:    playerGameLogsTable.value,
    })
    .from(playerGameLogsTable)
    .where(and(
      inArray(playerGameLogsTable.playerId, playerIds),
      inArray(playerGameLogsTable.gameDate, dates),
    ));

  const logMap = new Map<string, number>();
  for (const gl of gameLogs) {
    logMap.set(`${gl.playerId}|${String(gl.gameDate)}|${gl.statType}`, Number(gl.value));
  }

  const datesWithData = new Set(gameLogs.map(gl => String(gl.gameDate)));

  let graded = 0;
  for (const pick of pastPicks) {
    const date     = String(entryDateMap.get(pick.entryId)!);
    const logValue = resolveLogValue(logMap, pick.playerId as number, date, pick.statType);

    let result: "hit" | "miss" | "dnp";
    if (logValue != null) {
      const line = Number(pick.lineValue);
      result = pick.direction === "more"
        ? (logValue >= line ? "hit" : "miss")
        : (logValue <= line ? "hit" : "miss");
    } else if (datesWithData.has(date)) {
      result = "dnp";
    } else {
      continue;
    }

    await db
      .update(entryPicksTable)
      .set({
        result,
        gradedBy: "auto",
        gradedAt: new Date(),
        actualResult: logValue != null ? String(logValue) : null,
      })
      .where(eq(entryPicksTable.id, pick.pickId));
    graded++;
  }

  return graded;
}

// ---------------------------------------------------------------------------
// Stats helper for GET /api/sync/auto-grade-stats (#93)
// ---------------------------------------------------------------------------
export async function getAutoGradeStats(): Promise<{
  pendingPastDated: number;
  pendingTotal: number;
}> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const pendingPicks = await db
    .select({ pickId: entryPicksTable.id, entryId: entryPicksTable.entryId })
    .from(entryPicksTable)
    .where(eq(entryPicksTable.result, "pending"));

  const pendingTotal = pendingPicks.length;
  if (pendingTotal === 0) return { pendingPastDated: 0, pendingTotal: 0 };

  const entryIds = [...new Set(pendingPicks.map(p => p.entryId))];
  const entryRows = await db
    .select({ id: entriesTable.id, entryDate: entriesTable.entryDate })
    .from(entriesTable)
    .where(inArray(entriesTable.id, entryIds));
  const entryDateMap = new Map(entryRows.map(e => [e.id, e.entryDate]));

  const pendingPastDated = pendingPicks.filter(p => {
    const d = entryDateMap.get(p.entryId);
    return d != null && String(d) < todayStr;
  }).length;

  return { pendingPastDated, pendingTotal };
}
