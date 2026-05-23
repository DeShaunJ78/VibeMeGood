import { pgTable, serial, varchar, numeric, integer, boolean, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const userSettingsTable = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  bankroll: numeric("bankroll").default("500"),
  unitSize: numeric("unit_size").default("25"),
  kellyFraction: numeric("kelly_fraction").default("0.25"),
  maxUnitsPerEntry: integer("max_units_per_entry").default(1),
  dailyLossLimit: numeric("daily_loss_limit"),
  hitRateAssumptions: jsonb("hit_rate_assumptions").default({
    goblinOver: 0.65, standardHigh: 0.58, standardMid: 0.52,
    standardLow: 0.47, demonUnder: 0.65, demonOver: 0.35,
  }),
  payoutConfig: jsonb("payout_config").default({
    power: { 2: 3, 3: 6, 4: 10, 5: 20, 6: 40 },
  }),
  edgeWeights: jsonb("edge_weights").default({ marketGap: 60, lineType: 25, ourProjection: 15 }),
  excludeDemonOvers: boolean("exclude_demon_overs").default(true),
  minEdgeToPlay: numeric("min_edge_to_play").default("4"),
  aiModel: varchar("ai_model", { length: 100 }).default("claude-sonnet-4-20250514"),
  excludedSports: jsonb("excluded_sports").default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("user_settings_unique").on(t.userId),
}));

export type UserSettings = typeof userSettingsTable.$inferSelect;
export type InsertUserSettings = typeof userSettingsTable.$inferInsert;
