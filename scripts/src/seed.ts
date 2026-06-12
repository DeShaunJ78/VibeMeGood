if (process.env.NODE_ENV === "production") {
  console.error("ERROR: Seed scripts must not run in production.");
  process.exit(1);
}

import { db } from "@workspace/db";
import {
  teamsTable, playersTable, gamesTable, ppLinesTable, ppLineHistoryTable,
  externalLinesTable, projectionsTable, injuriesTable, lineupConfirmationsTable,
  propScoresTable, entriesTable, entryPicksTable, watchlistItemsTable,
  alertsTable, payoutConfigTable, gameEnvironmentTable, lineMoveEventsTable,
  nflAdvancedMetricsTable,
} from "@workspace/db/schema";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`TRUNCATE TABLE
    alerts, watchlist_items, entry_picks, entries, prop_scores,
    lineup_confirmations, injuries, projections, external_lines,
    pp_line_history, line_move_events, pp_lines, game_environment,
    games, players, teams, payout_config
    RESTART IDENTITY CASCADE`);

  // ---- Teams ----
  const nbaTeams = [
    { sport: "NBA", name: "Boston Celtics", abbreviation: "BOS", city: "Boston" },
    { sport: "NBA", name: "Golden State Warriors", abbreviation: "GSW", city: "San Francisco" },
    { sport: "NBA", name: "Los Angeles Lakers", abbreviation: "LAL", city: "Los Angeles" },
    { sport: "NBA", name: "Phoenix Suns", abbreviation: "PHX", city: "Phoenix" },
    { sport: "NBA", name: "Denver Nuggets", abbreviation: "DEN", city: "Denver" },
    { sport: "NBA", name: "Miami Heat", abbreviation: "MIA", city: "Miami" },
    { sport: "NBA", name: "Milwaukee Bucks", abbreviation: "MIL", city: "Milwaukee" },
    { sport: "NBA", name: "Cleveland Cavaliers", abbreviation: "CLE", city: "Cleveland" },
  ];
  const nflTeams = [
    { sport: "NFL", name: "Kansas City Chiefs", abbreviation: "KC", city: "Kansas City" },
    { sport: "NFL", name: "San Francisco 49ers", abbreviation: "SF", city: "San Francisco" },
    { sport: "NFL", name: "Buffalo Bills", abbreviation: "BUF", city: "Buffalo" },
    { sport: "NFL", name: "Dallas Cowboys", abbreviation: "DAL", city: "Dallas" },
  ];
  const mlbTeams = [
    { sport: "MLB", name: "Los Angeles Dodgers", abbreviation: "LAD", city: "Los Angeles" },
    { sport: "MLB", name: "New York Yankees", abbreviation: "NYY", city: "New York" },
    { sport: "MLB", name: "Houston Astros", abbreviation: "HOU", city: "Houston" },
    { sport: "MLB", name: "Atlanta Braves", abbreviation: "ATL", city: "Atlanta" },
  ];

  const teams = await db.insert(teamsTable).values([...nbaTeams, ...nflTeams, ...mlbTeams]).returning();
  const teamsByAbbr = Object.fromEntries(teams.map(t => [t.abbreviation, t]));
  console.log(`Inserted ${teams.length} teams`);

  // ---- Players ----
  const playerDefs = [
    { sport: "NBA", fullName: "Jayson Tatum", firstName: "Jayson", lastName: "Tatum", teamId: teamsByAbbr["BOS"].id, position: "SF", status: "active" },
    { sport: "NBA", fullName: "Jaylen Brown", firstName: "Jaylen", lastName: "Brown", teamId: teamsByAbbr["BOS"].id, position: "SG", status: "active" },
    { sport: "NBA", fullName: "Stephen Curry", firstName: "Stephen", lastName: "Curry", teamId: teamsByAbbr["GSW"].id, position: "PG", status: "active" },
    { sport: "NBA", fullName: "Klay Thompson", firstName: "Klay", lastName: "Thompson", teamId: teamsByAbbr["LAL"].id, position: "SG", status: "active" },
    { sport: "NBA", fullName: "LeBron James", firstName: "LeBron", lastName: "James", teamId: teamsByAbbr["LAL"].id, position: "SF", status: "active" },
    { sport: "NBA", fullName: "Kevin Durant", firstName: "Kevin", lastName: "Durant", teamId: teamsByAbbr["PHX"].id, position: "SF", status: "active" },
    { sport: "NBA", fullName: "Devin Booker", firstName: "Devin", lastName: "Booker", teamId: teamsByAbbr["PHX"].id, position: "SG", status: "active" },
    { sport: "NBA", fullName: "Nikola Jokic", firstName: "Nikola", lastName: "Jokic", teamId: teamsByAbbr["DEN"].id, position: "C", status: "active" },
    { sport: "NBA", fullName: "Jamal Murray", firstName: "Jamal", lastName: "Murray", teamId: teamsByAbbr["DEN"].id, position: "PG", status: "active" },
    { sport: "NBA", fullName: "Jimmy Butler", firstName: "Jimmy", lastName: "Butler", teamId: teamsByAbbr["MIA"].id, position: "SF", status: "questionable" },
    { sport: "NBA", fullName: "Giannis Antetokounmpo", firstName: "Giannis", lastName: "Antetokounmpo", teamId: teamsByAbbr["MIL"].id, position: "PF", status: "active" },
    { sport: "NBA", fullName: "Donovan Mitchell", firstName: "Donovan", lastName: "Mitchell", teamId: teamsByAbbr["CLE"].id, position: "SG", status: "active" },
    { sport: "NFL", fullName: "Patrick Mahomes", firstName: "Patrick", lastName: "Mahomes", teamId: teamsByAbbr["KC"].id, position: "QB", status: "active" },
    { sport: "NFL", fullName: "Travis Kelce", firstName: "Travis", lastName: "Kelce", teamId: teamsByAbbr["KC"].id, position: "TE", status: "active" },
    { sport: "NFL", fullName: "Christian McCaffrey", firstName: "Christian", lastName: "McCaffrey", teamId: teamsByAbbr["SF"].id, position: "RB", status: "questionable" },
    { sport: "NFL", fullName: "Josh Allen", firstName: "Josh", lastName: "Allen", teamId: teamsByAbbr["BUF"].id, position: "QB", status: "active" },
    { sport: "NFL", fullName: "CeeDee Lamb", firstName: "CeeDee", lastName: "Lamb", teamId: teamsByAbbr["DAL"].id, position: "WR", status: "active" },
    { sport: "MLB", fullName: "Mookie Betts", firstName: "Mookie", lastName: "Betts", teamId: teamsByAbbr["LAD"].id, position: "SS", status: "active" },
    { sport: "MLB", fullName: "Freddie Freeman", firstName: "Freddie", lastName: "Freeman", teamId: teamsByAbbr["LAD"].id, position: "1B", status: "active" },
    { sport: "MLB", fullName: "Aaron Judge", firstName: "Aaron", lastName: "Judge", teamId: teamsByAbbr["NYY"].id, position: "RF", status: "active" },
    { sport: "MLB", fullName: "Yordan Alvarez", firstName: "Yordan", lastName: "Alvarez", teamId: teamsByAbbr["HOU"].id, position: "DH", status: "active" },
  ];

  const players = await db.insert(playersTable).values(playerDefs).returning();
  const playersByName = Object.fromEntries(players.map(p => [p.fullName, p]));
  console.log(`Inserted ${players.length} players`);

  // ---- Games ----
  const today = new Date();
  today.setHours(19, 30, 0, 0);
  const todayPlus1 = new Date(today.getTime() + 3600000);
  const todayPlus2 = new Date(today.getTime() + 7200000);

  const gameDefs = [
    { sport: "NBA", homeTeamId: teamsByAbbr["BOS"].id, awayTeamId: teamsByAbbr["MIA"].id, startTime: today, status: "scheduled", spread: "-6.5", total: "215.5" },
    { sport: "NBA", homeTeamId: teamsByAbbr["DEN"].id, awayTeamId: teamsByAbbr["PHX"].id, startTime: today, status: "scheduled", spread: "-4.5", total: "220.0" },
    { sport: "NBA", homeTeamId: teamsByAbbr["MIL"].id, awayTeamId: teamsByAbbr["CLE"].id, startTime: todayPlus1, status: "scheduled", spread: "-2.0", total: "218.5" },
    { sport: "NBA", homeTeamId: teamsByAbbr["GSW"].id, awayTeamId: teamsByAbbr["LAL"].id, startTime: todayPlus2, status: "scheduled", spread: "3.5", total: "226.0" },
    { sport: "NFL", homeTeamId: teamsByAbbr["KC"].id, awayTeamId: teamsByAbbr["BUF"].id, startTime: today, status: "scheduled", spread: "-3.0", total: "52.5" },
    { sport: "NFL", homeTeamId: teamsByAbbr["DAL"].id, awayTeamId: teamsByAbbr["SF"].id, startTime: todayPlus1, status: "scheduled", spread: "+1.5", total: "48.0" },
  ];

  const games = await db.insert(gamesTable).values(gameDefs).returning();
  // Named references for clarity
  const nflGame1 = games[4]; // KC vs BUF
  const nflGame2 = games[5]; // DAL vs SF
  console.log(`Inserted ${games.length} games`);

  // ---- Game Environment (pace + totals for GPP filters) ----
  // impliedPace: NBA ~96-106 possessions/48 min; NFL total carries game pace signal
  // environmentScore: composite 0-100 (higher = better GPP environment)
  await db.insert(gameEnvironmentTable).values([
    // BOS vs MIA — tight defensive game, moderate pace
    { gameId: games[0].id, gameTotal: "215.5", impliedPace: "98.2", environmentScore: 62, notes: "BOS defense suppresses MIA pace; moderate GPP environment" },
    // DEN vs PHX — up-tempo, high-scoring — best GPP slate
    { gameId: games[1].id, gameTotal: "220.0", impliedPace: "104.7", environmentScore: 85, notes: "DEN-PHX historically fast pace; high total favors overs across the board" },
    // MIL vs CLE — physical, slower pace
    { gameId: games[2].id, gameTotal: "218.5", impliedPace: "100.1", environmentScore: 70, notes: "Giannis volume offsets slower tempo; solid mid-tier GPP game" },
    // GSW vs LAL — fastest-paced NBA game today; high ownership expected
    { gameId: games[3].id, gameTotal: "226.0", impliedPace: "106.3", environmentScore: 92, notes: "GSW-LAL is the marquee pace game; highest total on slate — elite GPP environment" },
    // KC vs BUF — high-scoring shootout, top NFL GPP game
    { gameId: nflGame1.id, gameTotal: "52.5", impliedPace: "67.4", environmentScore: 88, notes: "KC-BUF classic shootout script; 52.5 total is among highest of NFL season" },
    // DAL vs SF — defensive, low total
    { gameId: nflGame2.id, gameTotal: "48.0", impliedPace: "61.8", environmentScore: 48, notes: "SF defense holds DAL offense in check; lower GPP ceiling" },
  ]);
  console.log("Inserted 6 game_environment rows");

  // ---- PP Lines: Player Picks ----
  const openedAt = new Date(Date.now() - 3600000 * 4);
  const playerLineDefs = [
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Points", directionalityType: "over_under", lineValue: "27.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Rebounds", directionalityType: "over_under", lineValue: "8.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Assists", directionalityType: "over_under", lineValue: "4.5", lineType: "demon", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Jaylen Brown"].id, gameId: games[0].id, statType: "Points", directionalityType: "over_under", lineValue: "22.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Jimmy Butler"].id, gameId: games[0].id, statType: "Points", directionalityType: "over_under", lineValue: "20.5", lineType: "goblin", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Points", directionalityType: "over_under", lineValue: "29.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Rebounds", directionalityType: "over_under", lineValue: "12.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Assists", directionalityType: "over_under", lineValue: "9.5", lineType: "demon", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Kevin Durant"].id, gameId: games[1].id, statType: "Points", directionalityType: "over_under", lineValue: "25.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Devin Booker"].id, gameId: games[1].id, statType: "Points", directionalityType: "over_under", lineValue: "24.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "Points", directionalityType: "over_under", lineValue: "30.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "Rebounds", directionalityType: "over_under", lineValue: "11.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Donovan Mitchell"].id, gameId: games[2].id, statType: "Points", directionalityType: "over_under", lineValue: "26.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "Points", directionalityType: "over_under", lineValue: "26.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "3-PT Made", directionalityType: "over_under", lineValue: "4.5", lineType: "demon", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "Points", directionalityType: "over_under", lineValue: "23.5", lineType: "goblin", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "Assists", directionalityType: "over_under", lineValue: "7.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Jamal Murray"].id, gameId: games[1].id, statType: "Points", directionalityType: "over_under", lineValue: "21.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    // ---- NFL per-game props (canonical stat_type names matching player_game_logs) ----
    // KC vs BUF
    { playerId: playersByName["Patrick Mahomes"].id, gameId: nflGame1.id, statType: "Pass Yards", directionalityType: "over_under", lineValue: "285.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Patrick Mahomes"].id, gameId: nflGame1.id, statType: "Pass TDs", directionalityType: "over_under", lineValue: "2.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Patrick Mahomes"].id, gameId: nflGame1.id, statType: "Rush Yards", directionalityType: "over_under", lineValue: "22.5", lineType: "goblin", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Travis Kelce"].id, gameId: nflGame1.id, statType: "Receiving Yards", directionalityType: "over_under", lineValue: "72.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Travis Kelce"].id, gameId: nflGame1.id, statType: "Rec TDs", directionalityType: "over_under", lineValue: "0.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Josh Allen"].id, gameId: nflGame1.id, statType: "Pass Yards", directionalityType: "over_under", lineValue: "260.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Josh Allen"].id, gameId: nflGame1.id, statType: "Pass TDs", directionalityType: "over_under", lineValue: "2.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Josh Allen"].id, gameId: nflGame1.id, statType: "Rush Yards", directionalityType: "over_under", lineValue: "47.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    // DAL vs SF
    { playerId: playersByName["Christian McCaffrey"].id, gameId: nflGame2.id, statType: "Rush Yards", directionalityType: "over_under", lineValue: "89.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Christian McCaffrey"].id, gameId: nflGame2.id, statType: "Rush TDs", directionalityType: "over_under", lineValue: "0.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["Christian McCaffrey"].id, gameId: nflGame2.id, statType: "Receiving Yards", directionalityType: "over_under", lineValue: "48.5", lineType: "goblin", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["CeeDee Lamb"].id, gameId: nflGame2.id, statType: "Receiving Yards", directionalityType: "over_under", lineValue: "82.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
    { playerId: playersByName["CeeDee Lamb"].id, gameId: nflGame2.id, statType: "Rec TDs", directionalityType: "over_under", lineValue: "0.5", lineType: "standard", pickCategory: "player", isActive: true, openedAt },
  ];

  // ---- PP Lines: Team Picks (PrizePicks Teams — moneylines, totals, spreads) ----
  // Team picks use playerId of a "dummy" player — we repurpose first player but set pickCategory=team
  // The actual team info is carried via teamId + teamPickType + statType label
  const teamLineDefs = [
    // BOS vs MIA — Team Totals
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Team Total Points", directionalityType: "over_under", lineValue: "112.5", lineType: "standard", pickCategory: "team", teamPickType: "total", teamId: teamsByAbbr["BOS"].id, isActive: true, openedAt },
    { playerId: playersByName["Jimmy Butler"].id, gameId: games[0].id, statType: "Team Total Points", directionalityType: "over_under", lineValue: "103.5", lineType: "standard", pickCategory: "team", teamPickType: "total", teamId: teamsByAbbr["MIA"].id, isActive: true, openedAt },
    // BOS Moneyline
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Win Moneyline", directionalityType: "yes_no", lineValue: "0.5", lineType: "standard", pickCategory: "team", teamPickType: "moneyline", teamId: teamsByAbbr["BOS"].id, isActive: true, openedAt },
    // DEN vs PHX — Spread & Total
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Spread Cover", directionalityType: "yes_no", lineValue: "-4.5", lineType: "standard", pickCategory: "team", teamPickType: "spread", teamId: teamsByAbbr["DEN"].id, isActive: true, openedAt },
    { playerId: playersByName["Kevin Durant"].id, gameId: games[1].id, statType: "Spread Cover", directionalityType: "yes_no", lineValue: "+4.5", lineType: "standard", pickCategory: "team", teamPickType: "spread", teamId: teamsByAbbr["PHX"].id, isActive: true, openedAt },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Team Total Points", directionalityType: "over_under", lineValue: "113.5", lineType: "standard", pickCategory: "team", teamPickType: "total", teamId: teamsByAbbr["DEN"].id, isActive: true, openedAt },
    // GSW vs LAL
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "Team Total Points", directionalityType: "over_under", lineValue: "119.5", lineType: "standard", pickCategory: "team", teamPickType: "total", teamId: teamsByAbbr["GSW"].id, isActive: true, openedAt },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "Win Moneyline", directionalityType: "yes_no", lineValue: "0.5", lineType: "standard", pickCategory: "team", teamPickType: "moneyline", teamId: teamsByAbbr["LAL"].id, isActive: true, openedAt },
  ];

  const lines = await db.insert(ppLinesTable).values([...playerLineDefs, ...teamLineDefs]).returning();
  const playerLines = lines.filter(l => l.pickCategory === "player");
  console.log(`Inserted ${lines.length} pp_lines (${playerLines.length} player, ${lines.length - playerLines.length} team picks)`);

  // ---- Line Move Events (sharp signal data for GPP filters) ----
  // sharpSignal: "sharp" (sharp money on over), "fade" (sharp money on under/against), "neutral"
  // sharpConfidence: "high", "medium", "low"
  // moveDirection: "up" (line moved up = books adjusting for over action), "down"
  const lineByPlayerStat = (name: string, stat: string) =>
    playerLines.find(l => l.playerId === playersByName[name].id && l.statType === stat);

  const tatum3pt = lineByPlayerStat("Jayson Tatum", "Points");       // games[0] — BOS-MIA
  const tatumReb = lineByPlayerStat("Jayson Tatum", "Rebounds");
  const jokicPts = lineByPlayerStat("Nikola Jokic", "Points");       // games[1] — DEN-PHX
  const jokicAst = lineByPlayerStat("Nikola Jokic", "Assists");
  const giannisP = lineByPlayerStat("Giannis Antetokounmpo", "Points"); // games[2]
  const curryPts = lineByPlayerStat("Stephen Curry", "Points");      // games[3] — GSW-LAL
  const curry3pt = lineByPlayerStat("Stephen Curry", "3-PT Made");
  const lbj      = lineByPlayerStat("LeBron James", "Points");
  const mahomes  = lineByPlayerStat("Patrick Mahomes", "Pass Yards"); // nflGame1
  const kelce    = lineByPlayerStat("Travis Kelce", "Receiving Yards");
  const cmc      = lineByPlayerStat("Christian McCaffrey", "Rush Yards"); // nflGame2

  const lineMoveRows = [
    // Tatum Points — sharp hammer on over, line steamed up
    ...(tatum3pt ? [
      { ppLineId: tatum3pt.id, bookName: "Pinnacle", prevLine: "26.5", newLine: "27.0", moveSize: "0.5", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 3.5), sharpSignal: "sharp", sharpConfidence: "high", sharpExplanation: "Reverse line movement — public on under but line rising; sharp over action detected at Pinnacle" },
      { ppLineId: tatum3pt.id, bookName: "Pinnacle", prevLine: "27.0", newLine: "27.5", moveSize: "0.5", moveDirection: "up", sequenceNumber: 2, capturedAt: new Date(Date.now() - 3600000 * 2), sharpSignal: "sharp", sharpConfidence: "high", sharpExplanation: "Second consecutive up-move with low public over%; sharp steam confirmed" },
    ] : []),
    // Tatum Rebounds — neutral / no strong signal
    ...(tatumReb ? [
      { ppLineId: tatumReb.id, bookName: "DraftKings", prevLine: "8.5", newLine: "8.5", moveSize: "0.0", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 2), sharpSignal: "neutral", sharpConfidence: "low", sharpExplanation: "Line stable; no sharp positioning detected" },
    ] : []),
    // Jokic Points — sharp action on over, biggest signal on slate
    ...(jokicPts ? [
      { ppLineId: jokicPts.id, bookName: "Pinnacle", prevLine: "28.5", newLine: "29.0", moveSize: "0.5", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 4), sharpSignal: "sharp", sharpConfidence: "high", sharpExplanation: "Sharp over hammer at open; 72% of money on under but line rises — classic sharp vs public split" },
      { ppLineId: jokicPts.id, bookName: "Pinnacle", prevLine: "29.0", newLine: "29.5", moveSize: "0.5", moveDirection: "up", sequenceNumber: 2, capturedAt: new Date(Date.now() - 3600000 * 2.5), sharpSignal: "sharp", sharpConfidence: "high", sharpExplanation: "Continued steam; books pricing in Jokic triple-double equity" },
    ] : []),
    // Jokic Assists — fade signal (sharp fading the over)
    ...(jokicAst ? [
      { ppLineId: jokicAst.id, bookName: "Pinnacle", prevLine: "10.0", newLine: "9.5", moveSize: "0.5", moveDirection: "down", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 3), sharpSignal: "fade", sharpConfidence: "medium", sharpExplanation: "Line dropped despite public over%; sharp under action on assists — PHX defensive scheme adjustment" },
    ] : []),
    // Giannis Points — sharp alignment on over
    ...(giannisP ? [
      { ppLineId: giannisP.id, bookName: "Pinnacle", prevLine: "29.5", newLine: "30.5", moveSize: "1.0", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 3), sharpSignal: "sharp", sharpConfidence: "high", sharpExplanation: "Full-point steam at open; sharp syndicates loading Giannis over vs CLE weak interior" },
    ] : []),
    // Curry Points — neutral opening, no sharp lean
    ...(curryPts ? [
      { ppLineId: curryPts.id, bookName: "DraftKings", prevLine: "26.5", newLine: "26.5", moveSize: "0.0", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 2), sharpSignal: "neutral", sharpConfidence: "low", sharpExplanation: "No significant movement; recreational and sharp money balanced on Curry points" },
    ] : []),
    // Curry 3-PT Made — sharp fade (under)
    ...(curry3pt ? [
      { ppLineId: curry3pt.id, bookName: "Pinnacle", prevLine: "5.0", newLine: "4.5", moveSize: "0.5", moveDirection: "down", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 2.5), sharpSignal: "fade", sharpConfidence: "medium", sharpExplanation: "Line drop despite high public over%; sharp money fading Curry 3s — LAL defense + early foul trouble risk" },
    ] : []),
    // LeBron Points — sharp over
    ...(lbj ? [
      { ppLineId: lbj.id, bookName: "Pinnacle", prevLine: "22.5", newLine: "23.5", moveSize: "1.0", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 3.5), sharpSignal: "sharp", sharpConfidence: "medium", sharpExplanation: "Large opening move; sharp action on LeBron over in a high-total game expected to go deep" },
    ] : []),
    // Mahomes Pass Yards — sharp over in high-total game
    ...(mahomes ? [
      { ppLineId: mahomes.id, bookName: "Pinnacle", prevLine: "280.5", newLine: "285.5", moveSize: "5.0", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 4), sharpSignal: "sharp", sharpConfidence: "high", sharpExplanation: "5-yard steam on Mahomes yards; KC-BUF pace model projects 60+ offensive snaps each" },
      { ppLineId: mahomes.id, bookName: "Pinnacle", prevLine: "285.5", newLine: "285.5", moveSize: "0.0", moveDirection: "up", sequenceNumber: 2, capturedAt: new Date(Date.now() - 3600000 * 1.5), sharpSignal: "sharp", sharpConfidence: "medium", sharpExplanation: "Line held after initial steam; books comfortable at 285.5, sharp still favor over" },
    ] : []),
    // Kelce Receiving Yards — neutral
    ...(kelce ? [
      { ppLineId: kelce.id, bookName: "DraftKings", prevLine: "72.5", newLine: "72.5", moveSize: "0.0", moveDirection: "up", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 2), sharpSignal: "neutral", sharpConfidence: "low", sharpExplanation: "Stable line; injury uncertainty (BUF CB matchup TBD) keeping books and sharps cautious" },
    ] : []),
    // CMC Rush Yards — sharp fade on over (ankle concern)
    ...(cmc ? [
      { ppLineId: cmc.id, bookName: "Pinnacle", prevLine: "92.5", newLine: "89.5", moveSize: "3.0", moveDirection: "down", sequenceNumber: 1, capturedAt: new Date(Date.now() - 3600000 * 3), sharpSignal: "fade", sharpConfidence: "high", sharpExplanation: "Line dropped 3 yards on limited practice report; sharp money fading CMC rush yards given ankle GTD status" },
    ] : []),
  ];

  await db.insert(lineMoveEventsTable).values(lineMoveRows);
  console.log(`Inserted ${lineMoveRows.length} line_move_events rows`);

  // ---- Line History ----
  const historyDefs = playerLines.flatMap(line => {
    const base = Number(line.lineValue);
    const openVal = (base - 0.5 + Math.round(Math.random()) * 0.5).toFixed(1);
    const midVal = (base + (Math.random() > 0.5 ? 0.5 : 0)).toFixed(1);
    return [
      { ppLineId: line.id, lineValue: openVal, lineType: line.lineType, capturedAt: new Date(Date.now() - 3600000 * 4) },
      { ppLineId: line.id, lineValue: midVal, lineType: line.lineType, capturedAt: new Date(Date.now() - 3600000 * 2) },
      { ppLineId: line.id, lineValue: line.lineValue, lineType: line.lineType, capturedAt: new Date() },
    ];
  });
  await db.insert(ppLineHistoryTable).values(historyDefs);
  console.log(`Inserted ${historyDefs.length} line history records`);

  // ---- External Lines ----
  const extLineDefs = [
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Points", bookName: "DraftKings", overLine: "27.5", overOdds: -115, underLine: "27.5", underOdds: -105, noVigOverProb: "0.508", noVigUnderProb: "0.492", pulledAt: new Date() },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Points", bookName: "FanDuel", overLine: "28.0", overOdds: -120, underLine: "28.0", underOdds: 100, noVigOverProb: "0.545", noVigUnderProb: "0.455", pulledAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Points", bookName: "DraftKings", overLine: "29.5", overOdds: -110, underLine: "29.5", underOdds: -110, noVigOverProb: "0.500", noVigUnderProb: "0.500", pulledAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Rebounds", bookName: "DraftKings", overLine: "12.5", overOdds: -130, underLine: "12.5", underOdds: 110, noVigOverProb: "0.565", noVigUnderProb: "0.435", pulledAt: new Date() },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "Points", bookName: "DraftKings", overLine: "30.5", overOdds: -115, underLine: "30.5", underOdds: -105, noVigOverProb: "0.523", noVigUnderProb: "0.477", pulledAt: new Date() },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "Points", bookName: "FanDuel", overLine: "26.5", overOdds: -108, underLine: "26.5", underOdds: -112, noVigOverProb: "0.510", noVigUnderProb: "0.490", pulledAt: new Date() },
    // NFL external lines
    { playerId: playersByName["Patrick Mahomes"].id, gameId: nflGame1.id, statType: "Pass Yards", bookName: "DraftKings", overLine: "285.5", overOdds: -112, underLine: "285.5", underOdds: -108, noVigOverProb: "0.505", noVigUnderProb: "0.495", pulledAt: new Date() },
    { playerId: playersByName["Patrick Mahomes"].id, gameId: nflGame1.id, statType: "Pass Yards", bookName: "FanDuel", overLine: "288.5", overOdds: -115, underLine: "288.5", underOdds: -105, noVigOverProb: "0.520", noVigUnderProb: "0.480", pulledAt: new Date() },
    { playerId: playersByName["Josh Allen"].id, gameId: nflGame1.id, statType: "Pass Yards", bookName: "DraftKings", overLine: "262.5", overOdds: -110, underLine: "262.5", underOdds: -110, noVigOverProb: "0.500", noVigUnderProb: "0.500", pulledAt: new Date() },
    { playerId: playersByName["Christian McCaffrey"].id, gameId: nflGame2.id, statType: "Rush Yards", bookName: "DraftKings", overLine: "92.5", overOdds: -118, underLine: "92.5", underOdds: -102, noVigOverProb: "0.536", noVigUnderProb: "0.464", pulledAt: new Date() },
    { playerId: playersByName["CeeDee Lamb"].id, gameId: nflGame2.id, statType: "Receiving Yards", bookName: "FanDuel", overLine: "82.5", overOdds: -110, underLine: "82.5", underOdds: -110, noVigOverProb: "0.500", noVigUnderProb: "0.500", pulledAt: new Date() },
  ];
  await db.insert(externalLinesTable).values(extLineDefs);
  console.log(`Inserted ${extLineDefs.length} external lines`);

  // ---- Projections ----
  const projDefs = [
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Points", projectedValue: "29.8", floorValue: "22.0", medianValue: "28.0", ceilingValue: "42.0", confidenceScore: "0.72", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Rebounds", projectedValue: "9.2", floorValue: "6.0", medianValue: "9.0", ceilingValue: "14.0", confidenceScore: "0.68", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "Assists", projectedValue: "5.1", floorValue: "3.0", medianValue: "5.0", ceilingValue: "9.0", confidenceScore: "0.61", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jaylen Brown"].id, gameId: games[0].id, statType: "Points", projectedValue: "23.4", floorValue: "16.0", medianValue: "22.0", ceilingValue: "33.0", confidenceScore: "0.70", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jimmy Butler"].id, gameId: games[0].id, statType: "Points", projectedValue: "17.3", floorValue: "10.0", medianValue: "17.0", ceilingValue: "28.0", confidenceScore: "0.52", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Points", projectedValue: "31.2", floorValue: "22.0", medianValue: "30.0", ceilingValue: "48.0", confidenceScore: "0.81", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Rebounds", projectedValue: "14.1", floorValue: "9.0", medianValue: "13.0", ceilingValue: "20.0", confidenceScore: "0.79", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "Assists", projectedValue: "8.9", floorValue: "5.0", medianValue: "9.0", ceilingValue: "14.0", confidenceScore: "0.74", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Kevin Durant"].id, gameId: games[1].id, statType: "Points", projectedValue: "27.8", floorValue: "19.0", medianValue: "27.0", ceilingValue: "38.0", confidenceScore: "0.75", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Devin Booker"].id, gameId: games[1].id, statType: "Points", projectedValue: "22.1", floorValue: "14.0", medianValue: "21.0", ceilingValue: "34.0", confidenceScore: "0.65", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "Points", projectedValue: "33.4", floorValue: "24.0", medianValue: "32.0", ceilingValue: "50.0", confidenceScore: "0.83", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "Rebounds", projectedValue: "12.7", floorValue: "8.0", medianValue: "12.0", ceilingValue: "18.0", confidenceScore: "0.78", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Donovan Mitchell"].id, gameId: games[2].id, statType: "Points", projectedValue: "28.5", floorValue: "18.0", medianValue: "27.0", ceilingValue: "40.0", confidenceScore: "0.71", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "Points", projectedValue: "29.3", floorValue: "19.0", medianValue: "28.0", ceilingValue: "42.0", confidenceScore: "0.76", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "3-PT Made", projectedValue: "5.2", floorValue: "2.0", medianValue: "5.0", ceilingValue: "9.0", confidenceScore: "0.69", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "Points", projectedValue: "24.1", floorValue: "16.0", medianValue: "23.0", ceilingValue: "36.0", confidenceScore: "0.73", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "Assists", projectedValue: "8.4", floorValue: "5.0", medianValue: "8.0", ceilingValue: "13.0", confidenceScore: "0.71", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jamal Murray"].id, gameId: games[1].id, statType: "Points", projectedValue: "23.9", floorValue: "15.0", medianValue: "23.0", ceilingValue: "35.0", confidenceScore: "0.67", projectionSource: "internal", generatedAt: new Date() },
  ];
  await db.insert(projectionsTable).values(projDefs);
  console.log(`Inserted ${projDefs.length} projections`);

  // ---- Prop Scores (player lines only) ----
  const scoredAt = new Date();
  const scoreDefs = playerLines.map((line, i) => {
    const projDef = projDefs.find(p => p.playerId === line.playerId && p.statType === line.statType);
    const proj = projDef ? Number(projDef.projectedValue) : Number(line.lineValue);
    const gap = proj - Number(line.lineValue);
    const edge = Math.min(100, Math.max(0, 50 + gap * 8));
    const stability = 55 + (i % 5) * 7;
    const market = 50 + (i % 4) * 6;
    const risk = 30 + (i % 6) * 5;
    const final = (edge * 0.4 + stability * 0.3 + market * 0.2 + (100 - risk) * 0.1);
    const actionTag = final >= 65 ? "PLAY" : final >= 48 ? "WATCH" : "PASS";
    return {
      playerId: line.playerId, gameId: line.gameId, statType: line.statType, ppLineId: line.id,
      edgeScore: String(Math.round(edge)), stabilityScore: String(Math.round(stability)),
      marketSupportScore: String(Math.round(market)), riskScore: String(Math.round(risk)),
      finalScore: String(Math.round(final)), actionTag,
      reasoning: {
        edgeReason: gap > 0 ? `Projection exceeds line by ${gap.toFixed(1)}` : `Line exceeds projection by ${Math.abs(gap).toFixed(1)}`,
        stabilityNote: stability > 70 ? "High historical consistency" : "Moderate variance",
        marketNote: market > 60 ? "Books aligned with play" : "Mixed market signal",
        riskNote: risk > 50 ? "Elevated risk — injury concern or high variance" : "Low risk profile",
      },
      scoredAt,
    };
  });
  await db.insert(propScoresTable).values(scoreDefs);
  console.log(`Inserted ${scoreDefs.length} prop scores`);

  // ---- Injuries ----
  await db.insert(injuriesTable).values([
    { playerId: playersByName["Jimmy Butler"].id, gameId: games[0].id, sport: "NBA", status: "questionable", note: "Knee soreness — limited in practice. GTD for tonight.", source: "ESPN", reportedAt: new Date(Date.now() - 3600000 * 2) },
    { playerId: playersByName["Jaylen Brown"].id, gameId: games[0].id, sport: "NBA", status: "healthy", note: "No injury designation. Full practice.", source: "beat_reporter", reportedAt: new Date(Date.now() - 3600000 * 1) },
    { playerId: playersByName["Jamal Murray"].id, gameId: games[1].id, sport: "NBA", status: "gtd", note: "Ankle — missed last two practices, still game-time decision.", source: "team_report", reportedAt: new Date(Date.now() - 3600000 * 3) },
    { playerId: playersByName["Christian McCaffrey"].id, gameId: nflGame2.id, sport: "NFL", status: "questionable", note: "Ankle — limited Wednesday and Thursday. Expect game-time decision.", source: "ESPN", reportedAt: new Date(Date.now() - 3600000 * 5) },
  ]);
  console.log("Inserted 4 injuries");

  // ---- Lineup Confirmations ----
  await db.insert(lineupConfirmationsTable).values([
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, isStarting: true, expectedMinutes: "36.5", minutesFloor: "30.0", minutesCeiling: "42.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, isStarting: true, expectedMinutes: "35.0", minutesFloor: "30.0", minutesCeiling: "40.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, isStarting: true, expectedMinutes: "33.5", minutesFloor: "28.0", minutesCeiling: "38.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, isStarting: true, expectedMinutes: "34.0", minutesFloor: "29.0", minutesCeiling: "39.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
    { playerId: playersByName["Patrick Mahomes"].id, gameId: nflGame1.id, isStarting: true, expectedMinutes: null, minutesFloor: null, minutesCeiling: null, confirmedAt: new Date(Date.now() - 3600000), source: "rotowire" },
    { playerId: playersByName["Josh Allen"].id, gameId: nflGame1.id, isStarting: true, expectedMinutes: null, minutesFloor: null, minutesCeiling: null, confirmedAt: new Date(Date.now() - 3600000), source: "rotowire" },
    { playerId: playersByName["Travis Kelce"].id, gameId: nflGame1.id, isStarting: true, expectedMinutes: null, minutesFloor: null, minutesCeiling: null, confirmedAt: new Date(Date.now() - 3600000), source: "rotowire" },
    { playerId: playersByName["CeeDee Lamb"].id, gameId: nflGame2.id, isStarting: true, expectedMinutes: null, minutesFloor: null, minutesCeiling: null, confirmedAt: new Date(Date.now() - 3600000), source: "rotowire" },
  ]);
  console.log("Inserted 8 lineup confirmations");

  // ---- Watchlist ----
  await db.insert(watchlistItemsTable).values([
    { playerId: playersByName["Nikola Jokic"].id, statType: "Points", directionPreference: "more", note: "Triple-double equity, elite consistency vs PHX" },
    { playerId: playersByName["Jayson Tatum"].id, statType: "Points", directionPreference: "more", note: "Strong matchup vs Butler-less MIA if Butler sits" },
    { playerId: playersByName["Giannis Antetokounmpo"].id, statType: "Rebounds", directionPreference: "more", note: "Volume rebounding vs small CLE front" },
  ]);
  console.log("Inserted 3 watchlist items");

  // ---- Alerts ----
  await db.insert(alertsTable).values([
    { type: "injury_update", severity: "warning", title: "Jimmy Butler GTD", message: "Butler questionable with knee soreness. Monitor through tipoff. Could affect MIA team total under.", isRead: false },
    { type: "line_move", severity: "info", title: "Jokic Points Line Up +0.5", message: "DEN-PHX Jokic points moved from 29.0 to 29.5 — sharp money on Over.", isRead: false },
    { type: "lineup_confirmed", severity: "info", title: "Giannis Confirmed Starter", message: "Antetokounmpo confirmed active and starting vs CLE.", isRead: true },
    { type: "sync_success", severity: "info", title: "Lines Refreshed", message: "PP lines snapshot completed. 18 player picks + 8 team picks tracked.", isRead: true },
    { type: "injury_update", severity: "warning", title: "McCaffrey Questionable", message: "CMC limited in practice Wed+Thu with ankle. Game-time decision vs DAL. Rush Yards line at 89.5 — monitor for lineup scratch.", isRead: false },
  ]);
  console.log("Inserted alerts");

  // ---- Historical Entries ----
  // Kelly adherence legend:
  //   adhering   → stake ≤ kellySuggested × 1.10
  //   over-sized → stake > kellySuggested × 1.10  (produces amber/red badge)
  const entryDefs = [
    // ── March 2026 (mixed adherence — 2 over-sized, 1 adhering) ──────────────
    { entryDate: "2026-03-15", entryType: "power", pickCount: 3, stake: "30", displayedPayoutMultiplier: "6",  potentialPayout: "180",  actualPayout: "0",    result: "loss",    notes: "Hot-streak tilt — sized well over Kelly. Paid for it.",           emotionalState: "frustrated", earlyExitEligible: false, kellySuggested: "22" },
    { entryDate: "2026-03-18", entryType: "power", pickCount: 2, stake: "15", displayedPayoutMultiplier: "3",  potentialPayout: "45",   actualPayout: "45",   result: "win",     notes: "Disciplined two-legger. Stayed well within Kelly.",                emotionalState: "confident",  earlyExitEligible: false, kellySuggested: "18" },
    { entryDate: "2026-03-25", entryType: "flex",  pickCount: 4, stake: "25", displayedPayoutMultiplier: "0",  potentialPayout: "62.5", actualPayout: "25",   result: "partial", notes: "3/4 but over-sized again. Need to trust the fraction.",             emotionalState: "neutral",    earlyExitEligible: false, kellySuggested: "20" },
    // ── April 2026 (mixed adherence — 1 over-sized, 2 adhering) ─────────────
    { entryDate: "2026-04-10", entryType: "power", pickCount: 3, stake: "18", displayedPayoutMultiplier: "6",  potentialPayout: "108",  actualPayout: "108",  result: "win",     notes: "Right-sized. Tatum and Jokic delivered cleanly.",                  emotionalState: "confident",  earlyExitEligible: false, kellySuggested: "22" },
    { entryDate: "2026-04-20", entryType: "power", pickCount: 2, stake: "20", displayedPayoutMultiplier: "3",  potentialPayout: "60",   actualPayout: "0",    result: "loss",    notes: "Chasing yesterday's loss — sized over Kelly again.",               emotionalState: "frustrated", earlyExitEligible: false, kellySuggested: "16" },
    { entryDate: "2026-04-28", entryType: "flex",  pickCount: 3, stake: "15", displayedPayoutMultiplier: "0",  potentialPayout: "75",   actualPayout: "75",   result: "win",     notes: "Back on track. Trusted model + Kelly fraction.",                   emotionalState: "confident",  earlyExitEligible: false, kellySuggested: "20" },
    // ── May 2026 ─────────────────────────────────────────────────────────────
    { entryDate: "2026-05-20", entryType: "power", pickCount: 3, stake: "20", displayedPayoutMultiplier: "6",  potentialPayout: "120",  actualPayout: "120",  result: "win",     notes: "Jokic monster + two easy ALT lines. Clean sweep.",                 emotionalState: "confident",  earlyExitEligible: false, kellySuggested: "26" },
    { entryDate: "2026-05-21", entryType: "flex",  pickCount: 4, stake: "20", displayedPayoutMultiplier: "0",  potentialPayout: "60",   actualPayout: "30",   result: "partial", notes: "3/4. Butler DNP killed the Tatum leg — correlation risk was worth it.", emotionalState: "neutral", earlyExitEligible: false, kellySuggested: "20" },
    { entryDate: "2026-05-22", entryType: "power", pickCount: 2, stake: "10", displayedPayoutMultiplier: "3",  potentialPayout: "30",   actualPayout: "0",    result: "loss",    notes: "Curry threes missed badly. Bad beat night.",                       emotionalState: "frustrated", earlyExitEligible: false, kellySuggested: "16" },
    { entryDate: "2026-05-22", entryType: "power", pickCount: 3, stake: "15", displayedPayoutMultiplier: "6",  potentialPayout: "90",   actualPayout: "90",   result: "win",     notes: "Evening game — Giannis and Donovan both went off.",                emotionalState: "confident",  earlyExitEligible: false, kellySuggested: "20" },
    { entryDate: "2026-05-23", entryType: "power", pickCount: 3, stake: "20", result: "pending", notes: "Building for tonight — waiting on Butler status.", earlyExitEligible: true, earlyExitValue: "14.50", kellySuggested: "24" },
  ];
  const entries = await db.insert(entriesTable).values(entryDefs).returning();
  console.log(`Inserted ${entries.length} entries`);

  // ---- Entry Picks ----
  // CLV convention (matches backend: entries.ts line ~726):
  //   clv = closingLine - lineValue  (for "more" direction)
  //   Positive CLV (green)  → closing line rose    (market agreed player scores more, you beat the close)
  //   Negative CLV (red)    → closing line dropped (market moved against you)
  //   Zero / null (grey)    → no movement or DNP/pending
  await db.insert(entryPicksTable).values([
    // ── entries[0] 2026-03-15 — 3-pick Power LOSS (over-sized: 30 > 22×1.10=24.2) ──
    { entryId: entries[0].id, playerId: playersByName["Nikola Jokic"].id,          statType: "Points",    direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.0", projectionGap: "1.5",  result: "miss", closingLine: "28.5", clv: "-1.0" },
    { entryId: entries[0].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "Points",    direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "32.0", projectionGap: "1.5",  result: "miss", closingLine: "29.5", clv: "-1.0" },
    { entryId: entries[0].id, playerId: playersByName["Stephen Curry"].id,         statType: "3-PT Made", direction: "more", lineValue: "4.5",  lineType: "demon",    yourProjection: "5.1",  projectionGap: "0.6",  result: "hit",  closingLine: "5.0",  clv: "0.5"  },

    // ── entries[1] 2026-03-18 — 2-pick Power WIN (adhering: 15 ≤ 18×1.10=19.8) ──
    { entryId: entries[1].id, playerId: playersByName["Jayson Tatum"].id,          statType: "Points",    direction: "more", lineValue: "27.5", lineType: "standard", yourProjection: "29.5", projectionGap: "2.0",  result: "hit",  closingLine: "28.5", clv: "1.0"  },
    { entryId: entries[1].id, playerId: playersByName["Kevin Durant"].id,          statType: "Points",    direction: "more", lineValue: "25.5", lineType: "standard", yourProjection: "27.0", projectionGap: "1.5",  result: "hit",  closingLine: "26.0", clv: "0.5"  },

    // ── entries[2] 2026-03-25 — 4-pick Flex PARTIAL (over-sized: 25 > 20×1.10=22) ──
    { entryId: entries[2].id, playerId: playersByName["Nikola Jokic"].id,          statType: "Points",    direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.5", projectionGap: "2.0",  result: "hit",  closingLine: "30.5", clv: "1.0"  },
    { entryId: entries[2].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "Rebounds",  direction: "more", lineValue: "11.5", lineType: "standard", yourProjection: "12.5", projectionGap: "1.0",  result: "hit",  closingLine: "11.5", clv: "0.0"  },
    { entryId: entries[2].id, playerId: playersByName["LeBron James"].id,          statType: "Assists",   direction: "more", lineValue: "7.5",  lineType: "standard", yourProjection: "8.5",  projectionGap: "1.0",  result: "hit",  closingLine: "7.5",  clv: "0.0"  },
    { entryId: entries[2].id, playerId: playersByName["Devin Booker"].id,          statType: "Points",    direction: "more", lineValue: "24.5", lineType: "standard", yourProjection: "22.0", projectionGap: "-2.5", result: "miss", closingLine: "23.5", clv: "-1.0" },

    // ── entries[3] 2026-04-10 — 3-pick Power WIN (adhering: 18 ≤ 22×1.10=24.2) ──
    { entryId: entries[3].id, playerId: playersByName["Jayson Tatum"].id,          statType: "Points",    direction: "more", lineValue: "27.5", lineType: "standard", yourProjection: "30.0", projectionGap: "2.5",  result: "hit",  closingLine: "29.0", clv: "1.5"  },
    { entryId: entries[3].id, playerId: playersByName["Nikola Jokic"].id,          statType: "Points",    direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "32.0", projectionGap: "2.5",  result: "hit",  closingLine: "30.5", clv: "1.0"  },
    { entryId: entries[3].id, playerId: playersByName["Donovan Mitchell"].id,      statType: "Points",    direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "28.0", projectionGap: "1.5",  result: "hit",  closingLine: "27.0", clv: "0.5"  },

    // ── entries[4] 2026-04-20 — 2-pick Power LOSS (over-sized: 20 > 16×1.10=17.6) ──
    { entryId: entries[4].id, playerId: playersByName["Stephen Curry"].id,         statType: "Points",    direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "28.5", projectionGap: "2.0",  result: "miss", closingLine: "25.5", clv: "-1.0" },
    { entryId: entries[4].id, playerId: playersByName["Jaylen Brown"].id,          statType: "Points",    direction: "more", lineValue: "22.5", lineType: "standard", yourProjection: "24.0", projectionGap: "1.5",  result: "miss", closingLine: "21.5", clv: "-1.0" },

    // ── entries[5] 2026-04-28 — 3-pick Flex WIN (adhering: 15 ≤ 20×1.10=22) ──
    { entryId: entries[5].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "Points",    direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.0", projectionGap: "2.5",  result: "hit",  closingLine: "32.0", clv: "1.5"  },
    { entryId: entries[5].id, playerId: playersByName["Kevin Durant"].id,          statType: "Points",    direction: "more", lineValue: "25.5", lineType: "standard", yourProjection: "27.5", projectionGap: "2.0",  result: "hit",  closingLine: "26.5", clv: "1.0"  },
    { entryId: entries[5].id, playerId: playersByName["Jamal Murray"].id,          statType: "Points",    direction: "more", lineValue: "21.5", lineType: "standard", yourProjection: "23.0", projectionGap: "1.5",  result: "hit",  closingLine: "22.0", clv: "0.5"  },

    // ── entries[6] 2026-05-20 — 3-pick Power WIN: favorable (+1.5), flat (0.0), unfavorable (-1.0) ──
    { entryId: entries[6].id, playerId: playersByName["Nikola Jokic"].id,          statType: "Points",    direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.2", projectionGap: "1.7",  result: "hit",  closingLine: "31.0", clv: "1.5"  },
    { entryId: entries[6].id, playerId: playersByName["Jayson Tatum"].id,          statType: "Rebounds",  direction: "more", lineValue: "8.5",  lineType: "standard", yourProjection: "9.2",  projectionGap: "0.7",  result: "hit",  closingLine: "8.5",  clv: "0.0"  },
    { entryId: entries[6].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "Points",    direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9",  result: "hit",  closingLine: "29.5", clv: "-1.0" },

    // ── entries[7] 2026-05-21 — 4-pick Flex PARTIAL: favorable, favorable, DNP, unfavorable ──
    { entryId: entries[7].id, playerId: playersByName["Jayson Tatum"].id,          statType: "Points",    direction: "more", lineValue: "27.5", lineType: "standard", yourProjection: "29.8", projectionGap: "2.3",  result: "hit",  closingLine: "29.0", clv: "1.5"  },
    { entryId: entries[7].id, playerId: playersByName["Kevin Durant"].id,          statType: "Points",    direction: "more", lineValue: "25.5", lineType: "standard", yourProjection: "27.8", projectionGap: "2.3",  result: "hit",  closingLine: "26.5", clv: "1.0"  },
    { entryId: entries[7].id, playerId: playersByName["Jimmy Butler"].id,          statType: "Points",    direction: "more", lineValue: "20.5", lineType: "goblin",   yourProjection: "17.3", projectionGap: "-3.2", result: "dnp",  closingLine: null,   clv: null   },
    { entryId: entries[7].id, playerId: playersByName["Devin Booker"].id,          statType: "Points",    direction: "more", lineValue: "24.5", lineType: "standard", yourProjection: "22.1", projectionGap: "-2.4", result: "miss", closingLine: "23.0", clv: "-1.5" },

    // ── entries[8] 2026-05-22 — 2-pick Power LOSS: favorable (+1.0), unfavorable (-0.5) ──
    { entryId: entries[8].id, playerId: playersByName["Stephen Curry"].id,         statType: "3-PT Made", direction: "more", lineValue: "4.5",  lineType: "demon",    yourProjection: "5.2",  projectionGap: "0.7",  result: "miss", closingLine: "5.5",  clv: "1.0"  },
    { entryId: entries[8].id, playerId: playersByName["LeBron James"].id,          statType: "Assists",   direction: "more", lineValue: "7.5",  lineType: "standard", yourProjection: "8.4",  projectionGap: "0.9",  result: "miss", closingLine: "7.0",  clv: "-0.5" },

    // ── entries[9] 2026-05-22 — 3-pick Power WIN: large favorable, flat, large unfavorable ──
    { entryId: entries[9].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "Points",    direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9",  result: "hit",  closingLine: "32.5", clv: "2.0"  },
    { entryId: entries[9].id, playerId: playersByName["Donovan Mitchell"].id,      statType: "Points",    direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "28.5", projectionGap: "2.0",  result: "hit",  closingLine: "26.5", clv: "0.0"  },
    { entryId: entries[9].id, playerId: playersByName["Nikola Jokic"].id,          statType: "Assists",   direction: "more", lineValue: "9.5",  lineType: "demon",    yourProjection: "8.9",  projectionGap: "-0.6", result: "hit",  closingLine: "8.0",  clv: "-1.5" },

    // ── entries[10] 2026-05-23 — 3-pick Power PENDING ──
    { entryId: entries[10].id, playerId: playersByName["Nikola Jokic"].id,          statType: "Points",    direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.2", projectionGap: "1.7",  result: "pending" },
    { entryId: entries[10].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "Points",    direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9",  result: "pending" },
    { entryId: entries[10].id, playerId: playersByName["Stephen Curry"].id,         statType: "Points",    direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "29.3", projectionGap: "2.8",  result: "pending" },
  ]);
  console.log("Inserted 33 entry picks (6 historical Mar/Apr + 15 May + 3 pending May)");

  // ---- NFL Advanced Metrics (Saber Sim: airYardsShare, aDOT, red zone) ----
  // Clear any existing rows first (not in the main TRUNCATE, no FK deps).
  await db.delete(nflAdvancedMetricsTable);
  await db.insert(nflAdvancedMetricsTable).values([
    // Travis Kelce — high-volume TE, deep threat, dominant red zone target
    { playerName: "Travis Kelce", team: "KC", position: "TE", season: 2024, week: 18,
      snapCount: 64, snapPct: "0.8900", targetShare: "0.2800", airYards: "89.0",
      airYardsShare: "0.3500", wopr: "0.7200", racr: "1.45", targets: 8,
      aDot: "11.13", redZoneTargetShare: "0.2500", redZoneCarryShare: null },
    // CeeDee Lamb — WR1, elite volume, moderate depth
    { playerName: "CeeDee Lamb", team: "DAL", position: "WR", season: 2024, week: 18,
      snapCount: 70, snapPct: "0.9500", targetShare: "0.3000", airYards: "97.0",
      airYardsShare: "0.3800", wopr: "0.7800", racr: "1.52", targets: 9,
      aDot: "10.78", redZoneTargetShare: "0.2200", redZoneCarryShare: null },
    // Christian McCaffrey — hybrid RB, short routes, heavy red zone carrier
    { playerName: "Christian McCaffrey", team: "SF", position: "RB", season: 2024, week: 18,
      snapCount: 58, snapPct: "0.7800", targetShare: "0.1800", airYards: "21.0",
      airYardsShare: "0.1000", wopr: "0.3800", racr: "0.62", targets: 5,
      aDot: "4.20", redZoneTargetShare: "0.0800", redZoneCarryShare: "0.2800" },
    // Patrick Mahomes — QB, no receiving metrics applicable
    { playerName: "Patrick Mahomes", team: "KC", position: "QB", season: 2024, week: 18,
      snapCount: 72, snapPct: "1.0000", targetShare: null, airYards: null,
      airYardsShare: null, wopr: null, racr: null, targets: null,
      aDot: null, redZoneTargetShare: null, redZoneCarryShare: null },
    // Josh Allen — QB, scrambler; no receiving factor needed
    { playerName: "Josh Allen", team: "BUF", position: "QB", season: 2024, week: 18,
      snapCount: 71, snapPct: "1.0000", targetShare: null, airYards: null,
      airYardsShare: null, wopr: null, racr: null, targets: null,
      aDot: null, redZoneTargetShare: null, redZoneCarryShare: null },
  ]);
  console.log("Inserted 5 NFL advanced metrics rows");

  // ---- Payout Config (Power + Flex — actual PrizePicks multipliers) ----
  await db.insert(payoutConfigTable).values([
    { providerName: "prizepicks", entryType: "power", pickCount: 2, config: { multiplier: 3.0, description: "2-pick Power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 3, config: { multiplier: 6.0, description: "3-pick Power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 4, config: { multiplier: 10.0, description: "4-pick Power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 5, config: { multiplier: 20.0, description: "5-pick Power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 6, config: { multiplier: 40.0, description: "6-pick Power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 2, config: { "2of2": 3.0, description: "2-pick Flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 3, config: { "3of3": 5.0, "2of3": 1.25, description: "3-pick Flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 4, config: { "4of4": 10.0, "3of4": 2.5, description: "4-pick Flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 5, config: { "5of5": 20.0, "4of5": 4.0, "3of5": 1.0, description: "5-pick Flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 6, config: { "6of6": 40.0, "5of6": 6.0, "4of6": 1.5, description: "6-pick Flex" }, effectiveAt: new Date("2026-01-01") },
  ]);
  console.log("Inserted payout configs");

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
