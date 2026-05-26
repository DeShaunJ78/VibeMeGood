import { db } from "@workspace/db";
import { playersTable, entriesTable, entryPicksTable } from "@workspace/db/schema";

type PickKey =
  | "jokicPts" | "jokicAst" | "jokicReb"
  | "tatumPts" | "tatumReb"
  | "brownPts"
  | "giannisPts" | "giannisReb"
  | "curryPts" | "curry3"
  | "lebronPts" | "lebronAst"
  | "durantPts"
  | "bookerPts"
  | "murrayPts"
  | "butlerPts"
  | "mitchPts";

interface PickResult { key: PickKey; result: "hit" | "miss" | "dnp"; }
interface EntryDef {
  date: string; type: "power" | "flex"; stake: number;
  result: "win" | "loss" | "partial"; emotion: string; notes: string;
  picks: PickResult[];
}

function computePayout(
  type: "power" | "flex", pickCount: number,
  result: "win" | "loss" | "partial", stake: number, hitCount: number
): number {
  if (result === "loss") return 0;
  if (type === "power") {
    if (result !== "win") return 0;
    const m: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };
    return stake * (m[pickCount] ?? 6);
  }
  if (type === "flex") {
    if (pickCount === 3) { return hitCount === 3 ? stake * 5 : hitCount === 2 ? stake * 1.25 : 0; }
    if (pickCount === 4) { return hitCount === 4 ? stake * 10 : hitCount === 3 ? stake * 2.5 : 0; }
    if (pickCount === 5) { return hitCount === 5 ? stake * 20 : hitCount === 4 ? stake * 4 : hitCount === 3 ? stake : 0; }
    if (pickCount === 6) { return hitCount === 6 ? stake * 40 : hitCount === 5 ? stake * 6 : hitCount === 4 ? stake * 1.5 : 0; }
  }
  return 0;
}

function potentialFor(type: "power" | "flex", pickCount: number, stake: number): number {
  if (type === "power") {
    const m: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 };
    return stake * (m[pickCount] ?? 6);
  }
  const m: Record<number, number> = { 3: 5, 4: 10, 5: 20, 6: 40 };
  return stake * (m[pickCount] ?? 5);
}

const TEMPLATES: Record<PickKey, {
  playerName: string; statType: string; direction: "more" | "less";
  lineValue: string; lineType: string; yourProjection: string; projectionGap: string; clv: string;
}> = {
  jokicPts:   { playerName: "Nikola Jokic",          statType: "points",      direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.2", projectionGap: "1.7",  clv: "0.5" },
  jokicAst:   { playerName: "Nikola Jokic",          statType: "assists",     direction: "more", lineValue: "9.5",  lineType: "demon",    yourProjection: "10.1", projectionGap: "0.6",  clv: "0.0" },
  jokicReb:   { playerName: "Nikola Jokic",          statType: "rebounds",    direction: "more", lineValue: "13.5", lineType: "standard", yourProjection: "14.8", projectionGap: "1.3",  clv: "0.3" },
  tatumPts:   { playerName: "Jayson Tatum",          statType: "points",      direction: "more", lineValue: "27.5", lineType: "standard", yourProjection: "29.8", projectionGap: "2.3",  clv: "0.0" },
  tatumReb:   { playerName: "Jayson Tatum",          statType: "rebounds",    direction: "more", lineValue: "8.5",  lineType: "standard", yourProjection: "9.2",  projectionGap: "0.7",  clv: "0.0" },
  brownPts:   { playerName: "Jaylen Brown",          statType: "points",      direction: "more", lineValue: "23.5", lineType: "standard", yourProjection: "25.1", projectionGap: "1.6",  clv: "0.2" },
  giannisPts: { playerName: "Giannis Antetokounmpo", statType: "points",      direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9",  clv: "0.0" },
  giannisReb: { playerName: "Giannis Antetokounmpo", statType: "rebounds",    direction: "more", lineValue: "11.5", lineType: "standard", yourProjection: "13.2", projectionGap: "1.7",  clv: "0.5" },
  curryPts:   { playerName: "Stephen Curry",         statType: "points",      direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "29.3", projectionGap: "2.8",  clv: "0.0" },
  curry3:     { playerName: "Stephen Curry",         statType: "threes_made", direction: "more", lineValue: "4.5",  lineType: "goblin",   yourProjection: "5.2",  projectionGap: "0.7",  clv: "0.0" },
  lebronPts:  { playerName: "LeBron James",          statType: "points",      direction: "more", lineValue: "22.5", lineType: "standard", yourProjection: "24.1", projectionGap: "1.6",  clv: "0.0" },
  lebronAst:  { playerName: "LeBron James",          statType: "assists",     direction: "more", lineValue: "7.5",  lineType: "standard", yourProjection: "8.4",  projectionGap: "0.9",  clv: "0.0" },
  durantPts:  { playerName: "Kevin Durant",          statType: "points",      direction: "more", lineValue: "25.5", lineType: "standard", yourProjection: "27.8", projectionGap: "2.3",  clv: "0.0" },
  bookerPts:  { playerName: "Devin Booker",          statType: "points",      direction: "more", lineValue: "24.5", lineType: "standard", yourProjection: "26.1", projectionGap: "1.6",  clv: "0.5" },
  murrayPts:  { playerName: "Jamal Murray",          statType: "points",      direction: "more", lineValue: "20.5", lineType: "standard", yourProjection: "22.3", projectionGap: "1.8",  clv: "0.0" },
  butlerPts:  { playerName: "Jimmy Butler",          statType: "points",      direction: "less", lineValue: "20.5", lineType: "goblin",   yourProjection: "17.3", projectionGap: "-3.2", clv: "0.0" },
  mitchPts:   { playerName: "Donovan Mitchell",      statType: "points",      direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "28.5", projectionGap: "2.0",  clv: "0.0" },
};

const ENTRIES: EntryDef[] = [
  // March
  { date: "2026-03-01", type: "power", stake: 20, result: "win",     emotion: "confident",  notes: "Jokic + Giannis + Tatum — clean sweep on all three.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "tatumPts", result: "hit" }] },
  { date: "2026-03-03", type: "power", stake: 15, result: "win",     emotion: "confident",  notes: "Two chalk plays. Carried the line easily.", picks: [{ key: "jokicReb", result: "hit" }, { key: "brownPts", result: "hit" }] },
  { date: "2026-03-06", type: "flex",  stake: 25, result: "loss",    emotion: "frustrated", notes: "0/3. Blowout — everyone got pulled early.", picks: [{ key: "curryPts", result: "miss" }, { key: "lebronPts", result: "miss" }, { key: "bookerPts", result: "miss" }] },
  { date: "2026-03-09", type: "power", stake: 30, result: "win",     emotion: "excited",    notes: "4-for-4! Biggest multiplier hit of the month. +$270.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "mitchPts", result: "hit" }] },
  { date: "2026-03-11", type: "power", stake: 20, result: "loss",    emotion: "neutral",    notes: "Curry threes in a tight game — went under at the buzzer.", picks: [{ key: "curry3", result: "miss" }, { key: "lebronAst", result: "hit" }, { key: "durantPts", result: "hit" }] },
  { date: "2026-03-14", type: "power", stake: 15, result: "win",     emotion: "neutral",    notes: "Easy chalk. No sweat.", picks: [{ key: "giannisReb", result: "hit" }, { key: "tatumReb", result: "hit" }] },
  { date: "2026-03-17", type: "power", stake: 20, result: "loss",    emotion: "anxious",    notes: "5-pick swing. Had 4/5 but Murray went down with ankle.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "brownPts", result: "hit" }, { key: "murrayPts", result: "miss" }] },
  { date: "2026-03-19", type: "flex",  stake: 25, result: "win",     emotion: "confident",  notes: "Flex 3-pick — all hit. 5× multiplier.", picks: [{ key: "jokicPts", result: "hit" }, { key: "durantPts", result: "hit" }, { key: "mitchPts", result: "hit" }] },
  { date: "2026-03-22", type: "flex",  stake: 25, result: "partial", emotion: "neutral",    notes: "3/4. Booker let me down but got the flex partial.", picks: [{ key: "jokicReb", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "bookerPts", result: "miss" }] },
  { date: "2026-03-25", type: "power", stake: 20, result: "win",     emotion: "confident",  notes: "Mid-week slate. Books and model agreed on all three.", picks: [{ key: "lebronPts", result: "hit" }, { key: "curryPts", result: "hit" }, { key: "giannisPts", result: "hit" }] },
  { date: "2026-03-28", type: "power", stake: 15, result: "win",     emotion: "neutral",    notes: "Brown + Murray value. Both delivered.", picks: [{ key: "brownPts", result: "hit" }, { key: "murrayPts", result: "hit" }] },

  // April
  { date: "2026-04-01", type: "power", stake: 20, result: "win",     emotion: "confident",  notes: "Start-of-month discipline. 3 high-confidence plays.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "giannisPts", result: "hit" }] },
  { date: "2026-04-04", type: "flex",  stake: 30, result: "loss",    emotion: "frustrated", notes: "0/4. Bad injury news pre-game tanked two legs.", picks: [{ key: "murrayPts", result: "miss" }, { key: "butlerPts", result: "miss" }, { key: "bookerPts", result: "miss" }, { key: "curry3", result: "miss" }] },
  { date: "2026-04-07", type: "power", stake: 25, result: "win",     emotion: "excited",    notes: "Premium stake — conviction play. Three PLAY-tagged props.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "mitchPts", result: "hit" }] },
  { date: "2026-04-10", type: "power", stake: 15, result: "loss",    emotion: "neutral",    notes: "LeBron DNP last minute. Kills the whole power entry.", picks: [{ key: "lebronPts", result: "dnp" }, { key: "curryPts", result: "hit" }] },
  { date: "2026-04-12", type: "power", stake: 20, result: "loss",    emotion: "anxious",    notes: "5-pick YOLO. Should have stopped at 3.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "curryPts", result: "miss" }, { key: "durantPts", result: "miss" }] },
  { date: "2026-04-14", type: "power", stake: 20, result: "win",     emotion: "confident",  notes: "Back to basics after the 5-pick miss. Clean 3-pick.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisReb", result: "hit" }, { key: "brownPts", result: "hit" }] },
  { date: "2026-04-17", type: "flex",  stake: 25, result: "partial", emotion: "neutral",    notes: "2/3. LeBron assists fell short. Took the 1.25× flex payout.", picks: [{ key: "tatumPts", result: "hit" }, { key: "mitchPts", result: "hit" }, { key: "lebronAst", result: "miss" }] },
  { date: "2026-04-20", type: "power", stake: 30, result: "win",     emotion: "excited",    notes: "4-pick power. All four came through. +$270 session.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "brownPts", result: "hit" }] },
  { date: "2026-04-22", type: "power", stake: 15, result: "win",     emotion: "confident",  notes: "Quick 2-pick chalk. Rebounding props are reliable.", picks: [{ key: "tatumReb", result: "hit" }, { key: "jokicReb", result: "hit" }] },
  { date: "2026-04-24", type: "power", stake: 20, result: "win",     emotion: "neutral",    notes: "Curry points over — expected after mid-week rest.", picks: [{ key: "curryPts", result: "hit" }, { key: "durantPts", result: "hit" }, { key: "bookerPts", result: "hit" }] },
  { date: "2026-04-27", type: "power", stake: 20, result: "loss",    emotion: "frustrated", notes: "Butler fade blew up — went for 28 despite questionable tag.", picks: [{ key: "butlerPts", result: "miss" }, { key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }] },
  { date: "2026-04-29", type: "power", stake: 25, result: "win",     emotion: "excited",    notes: "End-of-month strong finish. 4-for-4.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "mitchPts", result: "hit" }, { key: "brownPts", result: "hit" }] },

  // May
  { date: "2026-05-01", type: "power", stake: 20, result: "win",     emotion: "confident",  notes: "May 1 reset. Clean 3-pick to start the month.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "giannisPts", result: "hit" }] },
  { date: "2026-05-03", type: "flex",  stake: 30, result: "loss",    emotion: "neutral",    notes: "1/4 — below flex threshold. Murray DNP and two misses.", picks: [{ key: "murrayPts", result: "dnp" }, { key: "bookerPts", result: "miss" }, { key: "curryPts", result: "miss" }, { key: "lebronPts", result: "hit" }] },
  { date: "2026-05-05", type: "power", stake: 25, result: "win",     emotion: "confident",  notes: "Playoff-intensity slate — big scorelines across the board.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "tatumPts", result: "hit" }] },
  { date: "2026-05-07", type: "power", stake: 15, result: "win",     emotion: "neutral",    notes: "Rebound props. High floor, lower variance.", picks: [{ key: "giannisReb", result: "hit" }, { key: "jokicReb", result: "hit" }] },
  { date: "2026-05-10", type: "power", stake: 20, result: "loss",    emotion: "anxious",    notes: "5-pick again. Need to stop reaching for 20×.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "curryPts", result: "miss" }, { key: "durantPts", result: "miss" }] },
  { date: "2026-05-12", type: "flex",  stake: 30, result: "win",     emotion: "excited",    notes: "3/3 flex. Clean sweep at 5× multiplier.", picks: [{ key: "jokicPts", result: "hit" }, { key: "mitchPts", result: "hit" }, { key: "brownPts", result: "hit" }] },
  { date: "2026-05-14", type: "power", stake: 25, result: "loss",    emotion: "frustrated", notes: "4-pick loss. Three hit, Booker barely missed under the line.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "bookerPts", result: "miss" }] },
  { date: "2026-05-15", type: "power", stake: 20, result: "win",     emotion: "confident",  notes: "Back on track. Only played props with projectionGap > 2.0.", picks: [{ key: "jokicPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "brownPts", result: "hit" }] },
  { date: "2026-05-16", type: "power", stake: 15, result: "win",     emotion: "confident",  notes: "Easy 2-pick. High floor plays.", picks: [{ key: "tatumReb", result: "hit" }, { key: "giannisReb", result: "hit" }] },
  { date: "2026-05-18", type: "flex",  stake: 25, result: "partial", emotion: "neutral",    notes: "3/4 flex. Murray DNP counted as miss. Took the 2.5× payout.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumPts", result: "hit" }, { key: "giannisPts", result: "hit" }, { key: "murrayPts", result: "miss" }] },
  { date: "2026-05-19", type: "power", stake: 20, result: "loss",    emotion: "frustrated", notes: "Late DNP news broke my 3-pick. Adjusting process going forward.", picks: [{ key: "curryPts", result: "miss" }, { key: "lebronPts", result: "hit" }, { key: "durantPts", result: "hit" }] },

  // May 20-22 (carry-over from original seed)
  { date: "2026-05-20", type: "power", stake: 20, result: "win",     emotion: "confident",  notes: "Jokic monster + two easy ALT lines. Clean sweep.", picks: [{ key: "jokicPts", result: "hit" }, { key: "tatumReb", result: "hit" }, { key: "giannisPts", result: "hit" }] },
  { date: "2026-05-21", type: "flex",  stake: 20, result: "partial", emotion: "neutral",    notes: "3/4. Butler DNP killed the Tatum leg — correlation risk.", picks: [{ key: "tatumPts", result: "hit" }, { key: "durantPts", result: "hit" }, { key: "butlerPts", result: "dnp" }, { key: "bookerPts", result: "miss" }] },
  { date: "2026-05-22", type: "power", stake: 10, result: "loss",    emotion: "frustrated", notes: "Curry threes missed badly. Bad beat night.", picks: [{ key: "curry3", result: "miss" }, { key: "lebronAst", result: "miss" }] },
  { date: "2026-05-22", type: "power", stake: 15, result: "win",     emotion: "confident",  notes: "Evening game — Giannis and Donovan both went off.", picks: [{ key: "giannisPts", result: "hit" }, { key: "mitchPts", result: "hit" }, { key: "jokicAst", result: "hit" }] },
];

async function seedEntries() {
  console.log("Seeding historical entries...");

  const players = await db.select().from(playersTable);
  const byName = Object.fromEntries(players.map(p => [p.fullName, p]));

  await db.delete(entryPicksTable);
  await db.delete(entriesTable);

  const entryRows = ENTRIES.map(e => {
    const hitCount = e.picks.filter(p => p.result === "hit").length;
    const effectivePicks = e.picks.filter(p => p.result !== "dnp").length;
    const payout = (e.result === "win" || e.result === "partial")
      ? computePayout(e.type, effectivePicks, e.result, e.stake, hitCount)
      : 0;
    const potential = potentialFor(e.type, e.picks.length, e.stake);
    return {
      entryDate: e.date,
      entryType: e.type,
      pickCount: e.picks.length,
      stake: String(e.stake),
      potentialPayout: String(potential),
      actualPayout: String(payout),
      result: e.result,
      notes: e.notes,
      emotionalState: e.emotion,
      earlyExitEligible: false,
    };
  });

  const inserted = await db.insert(entriesTable).values(entryRows).returning();
  console.log(`Inserted ${inserted.length} entries`);

  const allPicks: typeof entryPicksTable.$inferInsert[] = [];
  for (let i = 0; i < ENTRIES.length; i++) {
    const def = ENTRIES[i];
    const entry = inserted[i];
    for (const pick of def.picks) {
      const tmpl = TEMPLATES[pick.key];
      const player = byName[tmpl.playerName];
      if (!player) { console.warn(`Player not found: ${tmpl.playerName}`); continue; }
      allPicks.push({
        entryId: entry.id,
        playerId: player.id,
        statType: tmpl.statType,
        direction: tmpl.direction,
        lineValue: tmpl.lineValue,
        lineType: tmpl.lineType,
        yourProjection: tmpl.yourProjection,
        projectionGap: tmpl.projectionGap,
        result: pick.result,
        closingLine: tmpl.lineValue,
        clv: pick.result !== "dnp" ? tmpl.clv : null,
      });
    }
  }

  const pendingEntries = await db.insert(entriesTable).values([{
    entryDate: "2026-05-23",
    entryType: "power",
    pickCount: 3,
    stake: "20",
    potentialPayout: "120",
    result: "pending",
    notes: "Building for tonight — waiting on Butler status.",
    earlyExitEligible: true,
    earlyExitValue: "14.50",
  }]).returning();

  const pe = pendingEntries[0];
  allPicks.push(
    { entryId: pe.id, playerId: byName["Nikola Jokic"].id,          statType: "points", direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.2", projectionGap: "1.7", result: "pending" },
    { entryId: pe.id, playerId: byName["Giannis Antetokounmpo"].id, statType: "points", direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9", result: "pending" },
    { entryId: pe.id, playerId: byName["Stephen Curry"].id,         statType: "points", direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "29.3", projectionGap: "2.8", result: "pending" },
  );

  await db.insert(entryPicksTable).values(allPicks);
  console.log(`Inserted ${allPicks.length} entry picks`);
  console.log("Done!");
  process.exit(0);
}

seedEntries().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
