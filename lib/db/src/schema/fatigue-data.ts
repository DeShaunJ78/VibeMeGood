import { pgTable, serial, integer, boolean, numeric, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { gamesTable } from "./games";

export const fatigueDataTable = pgTable("fatigue_data", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id),
  gameId: integer("game_id").references(() => gamesTable.id),
  gameDate: date("game_date").notNull(),
  daysRest: integer("days_rest"),
  isBackToBack: boolean("is_back_to_back").default(false),
  isThreeInFour: boolean("is_three_in_four").default(false),
  prevGameMinutes: numeric("prev_game_minutes"),
  prevGameWasOT: boolean("prev_game_was_ot").default(false),
  travelMiles: integer("travel_miles"),
  timezoneShiftHours: integer("timezone_shift_hours").default(0),
  isEarlyGame: boolean("is_early_game").default(false),
  fatigueScore: integer("fatigue_score"),
  computedAt: timestamp("computed_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("fatigue_data_unique").on(t.playerId, t.gameId),
}));

export type FatigueData = typeof fatigueDataTable.$inferSelect;
export type InsertFatigueData = typeof fatigueDataTable.$inferInsert;
