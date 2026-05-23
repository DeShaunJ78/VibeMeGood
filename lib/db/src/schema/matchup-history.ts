import { pgTable, serial, integer, numeric, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { teamsTable } from "./teams";

export const matchupHistoryTable = pgTable("matchup_history", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id),
  opponentTeamId: integer("opponent_team_id").references(() => teamsTable.id),
  statType: varchar("stat_type", { length: 100 }).notNull(),
  gamesPlayed: integer("games_played").default(0),
  avgValue: numeric("avg_value"),
  overRateAtCurrentLine: numeric("over_rate_at_current_line"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("matchup_unique").on(t.playerId, t.opponentTeamId, t.statType),
}));

export type MatchupHistory = typeof matchupHistoryTable.$inferSelect;
export type InsertMatchupHistory = typeof matchupHistoryTable.$inferInsert;
