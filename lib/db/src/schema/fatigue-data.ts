import {
  pgTable, serial, integer, numeric, boolean,
  varchar, date, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const fatigueDataTable = pgTable("fatigue_data", {
  id:                  serial("id").primaryKey(),
  playerId:            integer("player_id").references(() => playersTable.id).notNull(),
  computedForDate:     date("computed_for_date").notNull(),

  lastGameDate:        date("last_game_date"),
  daysRest:            integer("days_rest"),
  isBackToBack:        boolean("is_back_to_back").default(false),
  isThreeInFour:       boolean("is_three_in_four").default(false),
  gamesLast7Days:      integer("games_last_7_days"),

  prevGameMinutes:     numeric("prev_game_minutes"),
  avgMinutesL5:        numeric("avg_minutes_l5"),
  prevGameHomeAway:    varchar("prev_game_home_away", { length: 4 }),

  travelMiles:         integer("travel_miles"),
  timezoneShiftHours:  integer("timezone_shift_hours").default(0),

  fatigueScore:        integer("fatigue_score").notNull(),
  fatigueLabel:        varchar("fatigue_label", { length: 50 }),
  warnings:            varchar("warnings", { length: 500 }),

  computedAt:          timestamp("computed_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("fatigue_data_unique").on(t.playerId, t.computedForDate),
}));

export type FatigueData = typeof fatigueDataTable.$inferSelect;
export type InsertFatigueData = typeof fatigueDataTable.$inferInsert;
