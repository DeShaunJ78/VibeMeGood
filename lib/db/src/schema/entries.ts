import { pgTable, serial, text, integer, numeric, timestamp, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entriesTable = pgTable("entries", {
  id: serial("id").primaryKey(),
  entryDate: date("entry_date").notNull(),
  entryType: text("entry_type").notNull(), // power | flex
  pickCount: integer("pick_count").notNull(),
  stake: numeric("stake").notNull(),
  displayedPayoutMultiplier: numeric("displayed_payout_multiplier"),
  potentialPayout: numeric("potential_payout"),
  actualPayout: numeric("actual_payout"),
  result: text("result").notNull().default("pending"), // pending | win | loss | partial | refund
  notes: text("notes"),
  emotionalState: text("emotional_state"),
  submittedAt: timestamp("submitted_at"),
  closedAt: timestamp("closed_at"),
  earlyExitEligible: boolean("early_exit_eligible").notNull().default(false),
  earlyExitValue: numeric("early_exit_value"),
  earlyExitUsed: boolean("early_exit_used").notNull().default(false),
  // Bankroll snapshot — frozen at log time so historical analysis is
  // independent of future Settings changes.
  snapshotBankroll: numeric("snapshot_bankroll"),
  snapshotUnitSize: numeric("snapshot_unit_size"),
  snapshotSuggestedStake: numeric("snapshot_suggested_stake"),
  // Half-Kelly dollar amount at log time — passed from client (which has
  // pick-level pOver + multiplier) and frozen here for adherence tracking.
  kellySuggested: numeric("kelly_suggested"),
  // Lineup-factory optimization objective used when this entry was built.
  // Null for entries logged before this field existed or via manual slip.
  // Used by the GPP backtest to compare gpp_mode vs standard entries.
  optimizationObjective: text("optimization_objective"),
});

export const insertEntrySchema = createInsertSchema(entriesTable).omit({ id: true });
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entriesTable.$inferSelect;
