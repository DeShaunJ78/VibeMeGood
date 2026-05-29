import { pgTable, serial, integer, numeric, text, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ppLinesTable = pgTable("pp_lines", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  gameId: integer("game_id"),
  statType: text("stat_type").notNull(),
  directionalityType: text("directionality_type").notNull().default("over_under"),
  lineValue: numeric("line_value").notNull(),
  lineType: text("line_type").notNull().default("standard"), // standard | demon | goblin
  payoutModifier: jsonb("payout_modifier"),
  openedAt: timestamp("opened_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  pickCategory: text("pick_category").notNull().default("player"), // player | team | culture
  teamPickType: text("team_pick_type"), // moneyline | spread | total | future (for team picks)
  teamId: integer("team_id"), // for team picks: which team this pick is on
  sourceSnapshotId: integer("source_snapshot_id"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pp_lines_unique").on(t.playerId, t.statType, t.lineValue, t.lineType),
]);

export const insertPpLineSchema = createInsertSchema(ppLinesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPpLine = z.infer<typeof insertPpLineSchema>;
export type PpLine = typeof ppLinesTable.$inferSelect;
