import { pgTable, serial, integer, numeric, smallint, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const nhlPlayerContextTable = pgTable("nhl_player_context", {
  id:            serial("id").primaryKey(),
  playerId:      integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  toiPerGame:    numeric("toi_per_game",    { precision: 5, scale: 2 }),  // minutes/game e.g. 21.50
  ppToiPerGame:  numeric("pp_toi_per_game", { precision: 5, scale: 2 }),  // PP minutes/game e.g. 3.20
  ppUnit:        smallint("pp_unit"),                                      // 1 = 1st unit, 2 = 2nd unit, null = not on PP
  corsiFor60:    numeric("corsi_for_60",    { precision: 6, scale: 2 }),  // Corsi For attempts / 60 min
  fenwickFor60:  numeric("fenwick_for_60",  { precision: 6, scale: 2 }),  // Fenwick For attempts / 60 min
  xGoalsPer60:   numeric("x_goals_per_60", { precision: 5, scale: 3 }),   // Expected goals / 60 min (nullable until xG feed available)
  updatedAt:     timestamp("updated_at").defaultNow(),
}, (t) => ({
  playerIdx: uniqueIndex("nhl_player_context_player_id_idx").on(t.playerId),
}));

export type NhlPlayerContext         = typeof nhlPlayerContextTable.$inferSelect;
export type InsertNhlPlayerContext   = typeof nhlPlayerContextTable.$inferInsert;
