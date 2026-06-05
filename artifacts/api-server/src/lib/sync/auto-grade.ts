import { db } from "@workspace/db";
import { entryPicksTable, entriesTable, playerGameLogsTable } from "@workspace/db/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Stat-type alias maps — fuzzy matching for pick→game-log linking (#94)
// The DB stores canonical names ("Points") but picks may arrive with
// abbreviations ("PTS") or vice-versa. We try both directions.
// ---------------------------------------------------------------------------
export const STAT_TYPE_ALIASES: Record<string, string> = {
  // NBA
  PTS:   "Points",
  REB:   "Rebounds",
  AST:   "Assists",
  STL:   "Steals",
  BLK:   "Blocks",
  "3PM": "3-Pointers Made",
  "3PA": "3-Point Attempts",
  TO:    "Turnovers",
  FGA:   "Field Goals Attempted",
  FGM:   "Field Goals Made",
  FTA:   "Free Throws Attempted",
  FTM:   "Free Throws Made",
  // MLB
  H:    "Hits",
  HR:   "Home Runs",
  RBI:  "RBIs",
  SB:   "Stolen Bases",
  BB:   "Walks",
  K:    "Strikeouts",
  SO:   "Strikeouts",
  ER:   "Earned Runs",
  IP:   "Innings Pitched",
  // NHL
  G:    "Goals",
  SOG:  "Shots on Goal",
  HIT:  "Hits",
  // NFL
  PassYds:  "Passing Yards",
  RushYds:  "Rushing Yards",
  RecYds:   "Receiving Yards",
  PassTD:   "Passing TDs",
  RushTD:   "Rushing TDs",
  RecTD:    "Receiving TDs",
  Rec:      "Receptions",
  PassAtt:  "Pass Attempts",
  RushAtt:  "Rush Attempts",
};

const reverseAliases: Record<string, string> = {};
for (const [abbrev, canonical] of Object.entries(STAT_TYPE_ALIASES)) {
  reverseAliases[canonical] = abbrev;
}

function resolveLogValue(
  logMap: Map<string, number>,
  playerId: number,
  date: string,
  statType: string,
): number | undefined {
  const exact = logMap.get(`${playerId}|${date}|${statType}`);
  if (exact != null) return exact;
  const aliased = STAT_TYPE_ALIASES[statType];
  if (aliased) {
    const v = logMap.get(`${playerId}|${date}|${aliased}`);
    if (v != null) return v;
  }
  const rev = reverseAliases[statType];
  if (rev) {
    const v = logMap.get(`${playerId}|${date}|${rev}`);
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
      .set({ result })
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
