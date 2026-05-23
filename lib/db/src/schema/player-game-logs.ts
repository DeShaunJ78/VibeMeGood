import { pgTable, serial, integer, numeric, varchar, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { gamesTable } from "./games";
import { teamsTable } from "./teams";

export const playerGameLogsTable = pgTable("player_game_logs", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id).notNull(),
  gameId: integer("game_id").references(() => gamesTable.id),
  gameDate: date("game_date").notNull(),
  statType: varchar("stat_type", { length: 100 }).notNull(),
  value: numeric("value").notNull(),
  minutes: numeric("minutes"),
  homeAway: varchar("home_away", { length: 4 }),
  opponentTeamId: integer("opponent_team_id").references(() => teamsTable.id),
  source: varchar("source", { length: 50 }).default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("player_game_log_unique").on(t.playerId, t.gameDate, t.statType),
}));

export type PlayerGameLog = typeof playerGameLogsTable.$inferSelect;
export type InsertPlayerGameLog = typeof playerGameLogsTable.$inferInsert;
