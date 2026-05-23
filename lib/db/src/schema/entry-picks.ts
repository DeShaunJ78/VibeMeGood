import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entryPicksTable = pgTable("entry_picks", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull(),
  ppLineId: integer("pp_line_id"),
  playerId: integer("player_id").notNull(),
  gameId: integer("game_id"),
  statType: text("stat_type").notNull(),
  direction: text("direction").notNull(), // more | less
  lineValue: numeric("line_value").notNull(),
  lineType: text("line_type").notNull(),
  yourProjection: numeric("your_projection"),
  projectionGap: numeric("projection_gap"),
  result: text("result").notNull().default("pending"), // pending | hit | miss | dnp | push
  closingLine: numeric("closing_line"),
  clv: numeric("clv"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEntryPickSchema = createInsertSchema(entryPicksTable).omit({ id: true, createdAt: true });
export type InsertEntryPick = z.infer<typeof insertEntryPickSchema>;
export type EntryPick = typeof entryPicksTable.$inferSelect;
