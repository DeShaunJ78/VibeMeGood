import { pgTable, serial, text, integer, numeric, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gamesTable = pgTable("games", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  homeTeamId: integer("home_team_id").notNull(),
  awayTeamId: integer("away_team_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  status: text("status").notNull().default("scheduled"),
  spread: numeric("spread"),
  total: numeric("total"),
  wasOT: boolean("was_ot").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertGameSchema = createInsertSchema(gamesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
