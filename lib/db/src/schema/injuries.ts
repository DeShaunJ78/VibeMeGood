import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const injuriesTable = pgTable("injuries", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  gameId: integer("game_id"),
  sport: text("sport").notNull(),
  status: text("status").notNull(), // questionable | doubtful | out | gtd | healthy
  note: text("note").notNull(),
  source: text("source").notNull(),
  reportedAt: timestamp("reported_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInjurySchema = createInsertSchema(injuriesTable).omit({ id: true, createdAt: true });
export type InsertInjury = z.infer<typeof insertInjurySchema>;
export type Injury = typeof injuriesTable.$inferSelect;
