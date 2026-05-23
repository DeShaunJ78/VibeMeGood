import { pgTable, serial, integer, boolean, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const lineupConfirmationsTable = pgTable("lineup_confirmations", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  gameId: integer("game_id").notNull(),
  isStarting: boolean("is_starting").notNull(),
  expectedMinutes: numeric("expected_minutes"),
  minutesFloor: numeric("minutes_floor"),
  minutesCeiling: numeric("minutes_ceiling"),
  confirmedAt: timestamp("confirmed_at").notNull(),
  source: text("source").notNull(),
});

export const insertLineupConfirmationSchema = createInsertSchema(lineupConfirmationsTable).omit({ id: true });
export type InsertLineupConfirmation = z.infer<typeof insertLineupConfirmationSchema>;
export type LineupConfirmation = typeof lineupConfirmationsTable.$inferSelect;
