import { pgTable, serial, integer, boolean, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ppLinesTable } from "./pp-lines";
import { playersTable } from "./players";

export const experimentalSignalsTable = pgTable("experimental_signals", {
  id: serial("id").primaryKey(),
  ppLineId: integer("pp_line_id").references(() => ppLinesTable.id),
  playerId: integer("player_id").references(() => playersTable.id),
  isBirthdayGame: boolean("is_birthday_game").default(false),
  isNewShoes: boolean("is_new_shoes").default(false),
  isHaircutGame: boolean("is_haircut_game").default(false),
  socialSpikeScore: integer("social_spike_score"),
  userNotes: text("user_notes"),
  computedAt: timestamp("computed_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("experimental_signals_unique").on(t.ppLineId),
}));

export type ExperimentalSignal = typeof experimentalSignalsTable.$inferSelect;
export type InsertExperimentalSignal = typeof experimentalSignalsTable.$inferInsert;
