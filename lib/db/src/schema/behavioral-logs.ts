import { pgTable, serial, varchar, integer, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { entriesTable } from "./entries";

export const behavioralLogsTable = pgTable("behavioral_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  entryId: integer("entry_id").references(() => entriesTable.id),
  timeOfDay: varchar("time_of_day", { length: 20 }),
  minutesSinceLastLoss: integer("minutes_since_last_loss"),
  deviatedFromOptimizer: boolean("deviated_from_optimizer").default(false),
  picksChangedFromOptimizer: integer("picks_changed_from_optimizer").default(0),
  stakeMultipleOfUnit: numeric("stake_multiple_of_unit"),
  emotionalState: varchar("emotional_state", { length: 50 }),
  secondsToDecision: integer("seconds_to_decision"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type BehavioralLog = typeof behavioralLogsTable.$inferSelect;
export type InsertBehavioralLog = typeof behavioralLogsTable.$inferInsert;
