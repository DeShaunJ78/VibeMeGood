import { pgTable, serial, integer, numeric, varchar, date, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const crowdOwnershipTable = pgTable("crowd_ownership_snapshots", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id),
  playerName: varchar("player_name", { length: 200 }).notNull(),
  statType: varchar("stat_type", { length: 100 }).notNull(),
  sport: varchar("sport", { length: 50 }).notNull(),
  slateDate: date("slate_date").notNull(),
  ownershipPct: numeric("ownership_pct", { precision: 5, scale: 2 }).notNull(),
  source: varchar("source", { length: 50 }).notNull().default("manual"),
  capturedAt: timestamp("captured_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("crowd_ownership_unique").on(t.playerId, t.statType, t.slateDate, t.source),
  slateDateIdx: index("crowd_ownership_slate_date_idx").on(t.slateDate),
  playerStatIdx: index("crowd_ownership_player_stat_idx").on(t.playerId, t.statType),
}));

export type CrowdOwnership = typeof crowdOwnershipTable.$inferSelect;
export type InsertCrowdOwnership = typeof crowdOwnershipTable.$inferInsert;
