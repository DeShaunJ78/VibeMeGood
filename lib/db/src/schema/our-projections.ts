import { pgTable, serial, integer, numeric, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { gamesTable } from "./games";

export const ourProjectionsTable = pgTable("our_projections", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id),
  gameId: integer("game_id").references(() => gamesTable.id),
  statType: varchar("stat_type", { length: 100 }).notNull(),
  projectedValue: numeric("projected_value").notNull(),
  weightedAvg: numeric("weighted_avg"),
  paceFactor: numeric("pace_factor"),
  defenseFactor: numeric("defense_factor"),
  restFactor: numeric("rest_factor"),
  gamesUsed: integer("games_used"),
  confidence: varchar("confidence", { length: 20 }),
  modelVersion: varchar("model_version", { length: 20 }).default("v1"),
  generatedAt: timestamp("generated_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("our_projections_unique").on(t.playerId, t.statType),
}));

export type OurProjection = typeof ourProjectionsTable.$inferSelect;
export type InsertOurProjection = typeof ourProjectionsTable.$inferInsert;
