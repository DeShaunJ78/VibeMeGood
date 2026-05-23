import { pgTable, serial, integer, numeric, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const externalLinesTable = pgTable("external_lines", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  gameId: integer("game_id"),
  statType: text("stat_type").notNull(),
  bookName: text("book_name").notNull(),
  overLine: numeric("over_line").notNull(),
  overOdds: integer("over_odds"),
  underLine: numeric("under_line").notNull(),
  underOdds: integer("under_odds"),
  noVigOverProb: numeric("no_vig_over_prob"),
  noVigUnderProb: numeric("no_vig_under_prob"),
  pulledAt: timestamp("pulled_at").notNull(),
  metadata: jsonb("metadata"),
});

export const insertExternalLineSchema = createInsertSchema(externalLinesTable).omit({ id: true });
export type InsertExternalLine = z.infer<typeof insertExternalLineSchema>;
export type ExternalLine = typeof externalLinesTable.$inferSelect;
