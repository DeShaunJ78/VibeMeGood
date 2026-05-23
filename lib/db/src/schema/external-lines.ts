import { pgTable, serial, integer, numeric, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ppLinesTable } from "./pp-lines";

export const externalLinesTable = pgTable("external_lines", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  ppLineId: integer("pp_line_id").references(() => ppLinesTable.id),
  gameId: integer("game_id"),
  statType: text("stat_type").notNull(),
  bookName: text("book_name").notNull(),
  lineValue: numeric("line_value"),
  overLine: numeric("over_line").notNull(),
  overOdds: integer("over_odds"),
  underLine: numeric("under_line").notNull(),
  underOdds: integer("under_odds"),
  noVigOverProb: numeric("no_vig_over_prob"),
  noVigUnderProb: numeric("no_vig_under_prob"),
  pulledAt: timestamp("pulled_at").notNull(),
  metadata: jsonb("metadata"),
}, (t) => ({
  uniq: uniqueIndex("external_lines_pp_book").on(t.ppLineId, t.bookName),
}));

export const insertExternalLineSchema = createInsertSchema(externalLinesTable).omit({ id: true });
export type InsertExternalLine = z.infer<typeof insertExternalLineSchema>;
export type ExternalLine = typeof externalLinesTable.$inferSelect;
