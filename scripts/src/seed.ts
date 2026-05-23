import { db } from "@workspace/db";
import {
  teamsTable, playersTable, gamesTable, ppLinesTable, ppLineHistoryTable,
  externalLinesTable, projectionsTable, injuriesTable, lineupConfirmationsTable,
  propScoresTable, entriesTable, entryPicksTable, watchlistItemsTable,
  alertsTable, payoutConfigTable
} from "@workspace/db/schema";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  // Clear existing data in dependency order
  await db.execute(sql`TRUNCATE TABLE
    alerts, watchlist_items, entry_picks, entries, prop_scores,
    lineup_confirmations, injuries, projections, external_lines,
    pp_line_history, pp_lines, games, players, teams, payout_config
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
  const now = new Date();
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
    { sport: "NFL", fullName: "Christian McCaffrey", firstName: "Christian", lastName: "McCaffrey", teamId: teamsByAbbr["SF"].id, position: "RB", status: "active" },
    { sport: "NFL", fullName: "Josh Allen", firstName: "Josh", lastName: "Allen", teamId: teamsByAbbr["BUF"].id, position: "QB", status: "active" },
    { sport: "MLB", fullName: "Mookie Betts", firstName: "Mookie", lastName: "Betts", teamId: teamsByAbbr["LAD"].id, position: "SS", status: "active" },
    { sport: "MLB", fullName: "Freddie Freeman", firstName: "Freddie", lastName: "Freeman", teamId: teamsByAbbr["LAD"].id, position: "1B", status: "active" },
    { sport: "MLB", fullName: "Aaron Judge", firstName: "Aaron", lastName: "Judge", teamId: teamsByAbbr["NYY"].id, position: "RF", status: "active" },
    { sport: "MLB", fullName: "Yordan Alvarez", firstName: "Yordan", lastName: "Alvarez", teamId: teamsByAbbr["HOU"].id, position: "DH", status: "active" },
  ];

  const players = await db.insert(playersTable).values(playerDefs).returning();
  const playersByName = Object.fromEntries(players.map(p => [p.fullName, p]));
  console.log(`Inserted ${players.length} players`);

  // ---- Games (today) ----
  const today = new Date();
  today.setHours(19, 30, 0, 0);
  const todayPlus1 = new Date(today.getTime() + 3600000);
  const todayPlus2 = new Date(today.getTime() + 7200000);

  const gameDefs = [
    { sport: "NBA", homeTeamId: teamsByAbbr["BOS"].id, awayTeamId: teamsByAbbr["MIA"].id, startTime: today, status: "scheduled", spread: "-6.5", total: "215.5" },
    { sport: "NBA", homeTeamId: teamsByAbbr["DEN"].id, awayTeamId: teamsByAbbr["PHX"].id, startTime: today, status: "scheduled", spread: "-4.5", total: "220.0" },
    { sport: "NBA", homeTeamId: teamsByAbbr["MIL"].id, awayTeamId: teamsByAbbr["CLE"].id, startTime: todayPlus1, status: "scheduled", spread: "-2.0", total: "218.5" },
    { sport: "NBA", homeTeamId: teamsByAbbr["GSW"].id, awayTeamId: teamsByAbbr["LAL"].id, startTime: todayPlus2, status: "scheduled", spread: "3.5", total: "226.0" },
  ];

  const games = await db.insert(gamesTable).values(gameDefs).returning();
  console.log(`Inserted ${games.length} games`);

  // ---- PP Lines ----
  const openedAt = new Date(Date.now() - 3600000 * 4);
  const lineDefs = [
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "points", directionalityType: "over_under", lineValue: "27.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "rebounds", directionalityType: "over_under", lineValue: "8.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "assists", directionalityType: "over_under", lineValue: "4.5", lineType: "demon", isActive: true, openedAt },
    { playerId: playersByName["Jaylen Brown"].id, gameId: games[0].id, statType: "points", directionalityType: "over_under", lineValue: "22.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Jimmy Butler"].id, gameId: games[0].id, statType: "points", directionalityType: "over_under", lineValue: "20.5", lineType: "goblin", isActive: true, openedAt },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "points", directionalityType: "over_under", lineValue: "29.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "rebounds", directionalityType: "over_under", lineValue: "12.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "assists", directionalityType: "over_under", lineValue: "9.5", lineType: "demon", isActive: true, openedAt },
    { playerId: playersByName["Kevin Durant"].id, gameId: games[1].id, statType: "points", directionalityType: "over_under", lineValue: "25.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Devin Booker"].id, gameId: games[1].id, statType: "points", directionalityType: "over_under", lineValue: "24.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "points", directionalityType: "over_under", lineValue: "30.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "rebounds", directionalityType: "over_under", lineValue: "11.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Donovan Mitchell"].id, gameId: games[2].id, statType: "points", directionalityType: "over_under", lineValue: "26.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "points", directionalityType: "over_under", lineValue: "26.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "threes_made", directionalityType: "over_under", lineValue: "4.5", lineType: "demon", isActive: true, openedAt },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "points", directionalityType: "over_under", lineValue: "23.5", lineType: "goblin", isActive: true, openedAt },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "assists", directionalityType: "over_under", lineValue: "7.5", lineType: "standard", isActive: true, openedAt },
    { playerId: playersByName["Jamal Murray"].id, gameId: games[1].id, statType: "points", directionalityType: "over_under", lineValue: "21.5", lineType: "standard", isActive: true, openedAt },
  ];

  const lines = await db.insert(ppLinesTable).values(lineDefs).returning();
  console.log(`Inserted ${lines.length} pp_lines`);

  // ---- Line History ----
  const historyDefs = lines.flatMap(line => {
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
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "points", bookName: "DraftKings", overLine: "27.5", overOdds: -115, underLine: "27.5", underOdds: -105, noVigOverProb: "0.508", noVigUnderProb: "0.492", pulledAt: new Date() },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "points", bookName: "FanDuel", overLine: "28.0", overOdds: -120, underLine: "28.0", underOdds: 100, noVigOverProb: "0.545", noVigUnderProb: "0.455", pulledAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "points", bookName: "DraftKings", overLine: "29.5", overOdds: -110, underLine: "29.5", underOdds: -110, noVigOverProb: "0.500", noVigUnderProb: "0.500", pulledAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "rebounds", bookName: "DraftKings", overLine: "12.5", overOdds: -130, underLine: "12.5", underOdds: 110, noVigOverProb: "0.565", noVigUnderProb: "0.435", pulledAt: new Date() },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "points", bookName: "DraftKings", overLine: "30.5", overOdds: -115, underLine: "30.5", underOdds: -105, noVigOverProb: "0.523", noVigUnderProb: "0.477", pulledAt: new Date() },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "points", bookName: "FanDuel", overLine: "26.5", overOdds: -108, underLine: "26.5", underOdds: -112, noVigOverProb: "0.510", noVigUnderProb: "0.490", pulledAt: new Date() },
  ];
  await db.insert(externalLinesTable).values(extLineDefs);
  console.log(`Inserted ${extLineDefs.length} external lines`);

  // ---- Projections ----
  const projDefs = [
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "points", projectedValue: "29.8", floorValue: "22.0", medianValue: "28.0", ceilingValue: "42.0", confidenceScore: "0.72", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "rebounds", projectedValue: "9.2", floorValue: "6.0", medianValue: "9.0", ceilingValue: "14.0", confidenceScore: "0.68", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, statType: "assists", projectedValue: "5.1", floorValue: "3.0", medianValue: "5.0", ceilingValue: "9.0", confidenceScore: "0.61", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jaylen Brown"].id, gameId: games[0].id, statType: "points", projectedValue: "23.4", floorValue: "16.0", medianValue: "22.0", ceilingValue: "33.0", confidenceScore: "0.70", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jimmy Butler"].id, gameId: games[0].id, statType: "points", projectedValue: "17.3", floorValue: "10.0", medianValue: "17.0", ceilingValue: "28.0", confidenceScore: "0.52", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "points", projectedValue: "31.2", floorValue: "22.0", medianValue: "30.0", ceilingValue: "48.0", confidenceScore: "0.81", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "rebounds", projectedValue: "14.1", floorValue: "9.0", medianValue: "13.0", ceilingValue: "20.0", confidenceScore: "0.79", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, statType: "assists", projectedValue: "8.9", floorValue: "5.0", medianValue: "9.0", ceilingValue: "14.0", confidenceScore: "0.74", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Kevin Durant"].id, gameId: games[1].id, statType: "points", projectedValue: "27.8", floorValue: "19.0", medianValue: "27.0", ceilingValue: "38.0", confidenceScore: "0.75", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Devin Booker"].id, gameId: games[1].id, statType: "points", projectedValue: "22.1", floorValue: "14.0", medianValue: "21.0", ceilingValue: "34.0", confidenceScore: "0.65", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "points", projectedValue: "33.4", floorValue: "24.0", medianValue: "32.0", ceilingValue: "50.0", confidenceScore: "0.83", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, statType: "rebounds", projectedValue: "12.7", floorValue: "8.0", medianValue: "12.0", ceilingValue: "18.0", confidenceScore: "0.78", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Donovan Mitchell"].id, gameId: games[2].id, statType: "points", projectedValue: "28.5", floorValue: "18.0", medianValue: "27.0", ceilingValue: "40.0", confidenceScore: "0.71", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "points", projectedValue: "29.3", floorValue: "19.0", medianValue: "28.0", ceilingValue: "42.0", confidenceScore: "0.76", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, statType: "threes_made", projectedValue: "5.2", floorValue: "2.0", medianValue: "5.0", ceilingValue: "9.0", confidenceScore: "0.69", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "points", projectedValue: "24.1", floorValue: "16.0", medianValue: "23.0", ceilingValue: "36.0", confidenceScore: "0.73", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["LeBron James"].id, gameId: games[3].id, statType: "assists", projectedValue: "8.4", floorValue: "5.0", medianValue: "8.0", ceilingValue: "13.0", confidenceScore: "0.71", projectionSource: "internal", generatedAt: new Date() },
    { playerId: playersByName["Jamal Murray"].id, gameId: games[1].id, statType: "points", projectedValue: "23.9", floorValue: "15.0", medianValue: "23.0", ceilingValue: "35.0", confidenceScore: "0.67", projectionSource: "internal", generatedAt: new Date() },
  ];
  await db.insert(projectionsTable).values(projDefs);
  console.log(`Inserted ${projDefs.length} projections`);

  // ---- Prop Scores ----
  const scoredAt = new Date();
  const scoreDefs = lines.map((line, i) => {
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
      playerId: line.playerId,
      gameId: line.gameId,
      statType: line.statType,
      ppLineId: line.id,
      edgeScore: String(Math.round(edge)),
      stabilityScore: String(Math.round(stability)),
      marketSupportScore: String(Math.round(market)),
      riskScore: String(Math.round(risk)),
      finalScore: String(Math.round(final)),
      actionTag,
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
  const injuryDefs = [
    { playerId: playersByName["Jimmy Butler"].id, gameId: games[0].id, sport: "NBA", status: "questionable", note: "Knee soreness — limited in practice. GTD for tonight.", source: "ESPN", reportedAt: new Date(Date.now() - 3600000 * 2) },
    { playerId: playersByName["Jaylen Brown"].id, gameId: games[0].id, sport: "NBA", status: "healthy", note: "No injury designation. Full practice.", source: "beat_reporter", reportedAt: new Date(Date.now() - 3600000 * 1) },
    { playerId: playersByName["Jamal Murray"].id, gameId: games[1].id, sport: "NBA", status: "gtd", note: "Ankle — missed last two practices, still game-time decision.", source: "team_report", reportedAt: new Date(Date.now() - 3600000 * 3) },
  ];
  await db.insert(injuriesTable).values(injuryDefs);
  console.log(`Inserted ${injuryDefs.length} injuries`);

  // ---- Lineup Confirmations ----
  const lineupDefs = [
    { playerId: playersByName["Jayson Tatum"].id, gameId: games[0].id, isStarting: true, expectedMinutes: "36.5", minutesFloor: "30.0", minutesCeiling: "42.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
    { playerId: playersByName["Nikola Jokic"].id, gameId: games[1].id, isStarting: true, expectedMinutes: "35.0", minutesFloor: "30.0", minutesCeiling: "40.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
    { playerId: playersByName["Giannis Antetokounmpo"].id, gameId: games[2].id, isStarting: true, expectedMinutes: "33.5", minutesFloor: "28.0", minutesCeiling: "38.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
    { playerId: playersByName["Stephen Curry"].id, gameId: games[3].id, isStarting: true, expectedMinutes: "34.0", minutesFloor: "29.0", minutesCeiling: "39.0", confirmedAt: new Date(Date.now() - 1800000), source: "rotowire" },
  ];
  await db.insert(lineupConfirmationsTable).values(lineupDefs);
  console.log(`Inserted ${lineupDefs.length} lineup confirmations`);

  // ---- Watchlist ----
  const watchDefs = [
    { playerId: playersByName["Nikola Jokic"].id, statType: "points", directionPreference: "more", note: "Triple-double equity, elite consistency vs PHX" },
    { playerId: playersByName["Jayson Tatum"].id, statType: "points", directionPreference: "more", note: "Strong matchup vs Butler-less MIA if Butler sits" },
    { playerId: playersByName["Giannis Antetokounmpo"].id, statType: "rebounds", directionPreference: "more", note: "Volume rebounding vs small CLE front" },
  ];
  await db.insert(watchlistItemsTable).values(watchDefs);
  console.log(`Inserted ${watchDefs.length} watchlist items`);

  // ---- Alerts ----
  await db.insert(alertsTable).values([
    { type: "injury_update", severity: "warning", title: "Jimmy Butler GTD", message: "Butler questionable with knee soreness. Monitor through tipoff. Could affect MIA team total.", isRead: false },
    { type: "line_move", severity: "info", title: "Jokic Points Line Up +0.5", message: "DEN-PHX Jokic points moved from 29.0 to 29.5 — sharp money on Over.", isRead: false },
    { type: "lineup_confirmed", severity: "info", title: "Giannis Confirmed Starter", message: "Antetokounmpo confirmed active and starting vs CLE.", isRead: true },
    { type: "sync_success", severity: "info", title: "Lines Refreshed", message: "PP lines snapshot completed. 18 active lines tracked.", isRead: true },
  ]);
  console.log("Inserted alerts");

  // ---- Historical Entries ----
  const entryDefs = [
    { entryDate: "2026-05-20", entryType: "power", pickCount: 3, stake: "20", displayedPayoutMultiplier: "6", potentialPayout: "120", actualPayout: "120", result: "win", notes: "Jokic monster + two easy ALT lines. Clean sweep.", emotionalState: "confident" },
    { entryDate: "2026-05-21", entryType: "flex", pickCount: 4, stake: "20", displayedPayoutMultiplier: "0", potentialPayout: "60", actualPayout: "30", result: "partial", notes: "3/4. Butler DNP killed the Tatum leg — correlation risk was worth it.", emotionalState: "neutral" },
    { entryDate: "2026-05-22", entryType: "power", pickCount: 2, stake: "10", displayedPayoutMultiplier: "3", potentialPayout: "30", actualPayout: "0", result: "loss", notes: "Curry threes missed badly. Bad beat night.", emotionalState: "frustrated" },
    { entryDate: "2026-05-22", entryType: "power", pickCount: 3, stake: "15", displayedPayoutMultiplier: "6", potentialPayout: "90", actualPayout: "90", result: "win", notes: "Evening game — Giannis and Donovan both went off.", emotionalState: "confident" },
    { entryDate: "2026-05-23", entryType: "power", pickCount: 3, stake: "20", result: "pending", notes: "Building for tonight — waiting on Butler status." },
  ];
  const entries = await db.insert(entriesTable).values(entryDefs).returning();
  console.log(`Inserted ${entries.length} entries`);

  // ---- Entry Picks ----
  const pickDefs = [
    // Entry 1 (win)
    { entryId: entries[0].id, playerId: playersByName["Nikola Jokic"].id, statType: "points", direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.2", projectionGap: "1.7", result: "hit", closingLine: "29.5", clv: "0.5" },
    { entryId: entries[0].id, playerId: playersByName["Jayson Tatum"].id, statType: "rebounds", direction: "more", lineValue: "8.5", lineType: "standard", yourProjection: "9.2", projectionGap: "0.7", result: "hit", closingLine: "8.5", clv: "0.0" },
    { entryId: entries[0].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "points", direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9", result: "hit", closingLine: "31.0", clv: "-0.5" },
    // Entry 2 (partial)
    { entryId: entries[1].id, playerId: playersByName["Jayson Tatum"].id, statType: "points", direction: "more", lineValue: "27.5", lineType: "standard", yourProjection: "29.8", projectionGap: "2.3", result: "hit", closingLine: "27.5", clv: "0.0" },
    { entryId: entries[1].id, playerId: playersByName["Kevin Durant"].id, statType: "points", direction: "more", lineValue: "25.5", lineType: "standard", yourProjection: "27.8", projectionGap: "2.3", result: "hit", closingLine: "25.5", clv: "0.0" },
    { entryId: entries[1].id, playerId: playersByName["Jimmy Butler"].id, statType: "points", direction: "more", lineValue: "20.5", lineType: "goblin", yourProjection: "17.3", projectionGap: "-3.2", result: "dnp", closingLine: null, clv: null },
    { entryId: entries[1].id, playerId: playersByName["Devin Booker"].id, statType: "points", direction: "more", lineValue: "24.5", lineType: "standard", yourProjection: "22.1", projectionGap: "-2.4", result: "miss", closingLine: "24.5", clv: "0.0" },
    // Entry 3 (loss)
    { entryId: entries[2].id, playerId: playersByName["Stephen Curry"].id, statType: "threes_made", direction: "more", lineValue: "4.5", lineType: "demon", yourProjection: "5.2", projectionGap: "0.7", result: "miss", closingLine: "4.5", clv: "0.0" },
    { entryId: entries[2].id, playerId: playersByName["LeBron James"].id, statType: "assists", direction: "more", lineValue: "7.5", lineType: "standard", yourProjection: "8.4", projectionGap: "0.9", result: "miss", closingLine: "7.5", clv: "0.0" },
    // Entry 4 (win)
    { entryId: entries[3].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "points", direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9", result: "hit", closingLine: "30.5", clv: "0.0" },
    { entryId: entries[3].id, playerId: playersByName["Donovan Mitchell"].id, statType: "points", direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "28.5", projectionGap: "2.0", result: "hit", closingLine: "26.5", clv: "0.0" },
    { entryId: entries[3].id, playerId: playersByName["Nikola Jokic"].id, statType: "assists", direction: "more", lineValue: "9.5", lineType: "demon", yourProjection: "8.9", projectionGap: "-0.6", result: "hit", closingLine: "9.5", clv: "0.0" },
    // Entry 5 (pending)
    { entryId: entries[4].id, playerId: playersByName["Nikola Jokic"].id, statType: "points", direction: "more", lineValue: "29.5", lineType: "standard", yourProjection: "31.2", projectionGap: "1.7", result: "pending" },
    { entryId: entries[4].id, playerId: playersByName["Giannis Antetokounmpo"].id, statType: "points", direction: "more", lineValue: "30.5", lineType: "standard", yourProjection: "33.4", projectionGap: "2.9", result: "pending" },
    { entryId: entries[4].id, playerId: playersByName["Stephen Curry"].id, statType: "points", direction: "more", lineValue: "26.5", lineType: "standard", yourProjection: "29.3", projectionGap: "2.8", result: "pending" },
  ];
  await db.insert(entryPicksTable).values(pickDefs);
  console.log(`Inserted ${pickDefs.length} entry picks`);

  // ---- Payout Config ----
  await db.insert(payoutConfigTable).values([
    { providerName: "prizepicks", entryType: "power", pickCount: 2, config: { multiplier: 3.0, description: "2-pick power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 3, config: { multiplier: 6.0, description: "3-pick power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 4, config: { multiplier: 10.0, description: "4-pick power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 5, config: { multiplier: 20.0, description: "5-pick power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "power", pickCount: 6, config: { multiplier: 40.0, description: "6-pick power" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 2, config: { "2of2": 3.0, description: "2-pick flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 3, config: { "3of3": 5.0, "2of3": 1.25, description: "3-pick flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 4, config: { "4of4": 10.0, "3of4": 2.5, description: "4-pick flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 5, config: { "5of5": 20.0, "4of5": 4.0, "3of5": 1.0, description: "5-pick flex" }, effectiveAt: new Date("2026-01-01") },
    { providerName: "prizepicks", entryType: "flex", pickCount: 6, config: { "6of6": 40.0, "5of6": 6.0, "4of6": 1.5, description: "6-pick flex" }, effectiveAt: new Date("2026-01-01") },
  ]);
  console.log("Inserted payout configs");

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
