import { pgTable, serial, integer, varchar, numeric, timestamp } from "drizzle-orm/pg-core";
import { gamesTable } from "./games";

export const refereeDataTable = pgTable("referee_data", {
  id: serial("id").primaryKey(),
  refName: varchar("ref_name", { length: 100 }).notNull().unique(),
  sport: varchar("sport", { length: 20 }).notNull(),
  foulsPerGameFactor: numeric("fouls_per_game_factor"),
  paceImpactFactor: numeric("pace_impact_factor"),
  ftAttemptsFactor: numeric("ft_attempts_factor"),
  technicalFoulRate: numeric("technical_foul_rate"),
  sampleGames: integer("sample_games").default(0),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const gameRefereeTable = pgTable("game_referee", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gamesTable.id),
  refereeId: integer("referee_id").references(() => refereeDataTable.id),
});

export type RefereeData = typeof refereeDataTable.$inferSelect;
export type InsertRefereeData = typeof refereeDataTable.$inferInsert;
export type GameReferee = typeof gameRefereeTable.$inferSelect;
export type InsertGameReferee = typeof gameRefereeTable.$inferInsert;
