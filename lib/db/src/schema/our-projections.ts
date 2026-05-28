import { pgTable, serial, integer, numeric, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";
import { gamesTable } from "./games";

export const ourProjectionsTable = pgTable("our_projections", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id),
  gameId: integer("game_id").references(() => gamesTable.id),
  statType: varchar("stat_type", { length: 100 }).notNull(),

  // Point estimate
  projectedValue: numeric("projected_value").notNull(),
  weightedAvg: numeric("weighted_avg"),

  // Distribution
  stdDev: numeric("std_dev"),
  pOver: numeric("p_over"),               // 0–100: P(X > ppLine)
  percentileAtLine: numeric("percentile_at_line"), // 0–100: where the line sits

  // Adjustments
  paceFactor: numeric("pace_factor"),
  defenseFactor: numeric("defense_factor"),
  restFactor: numeric("rest_factor"),
  opponentAdj: numeric("opponent_adj").default("1"),

  // Shrinkage
  shrinkageFactor: numeric("shrinkage_factor"), // 0=no shrinkage, 1=full prior
  gamesUsed: integer("games_used"),

  // Quality + explainability
  dataQualityScore: integer("data_quality_score"), // 0–100
  sourceLabel: varchar("source_label", { length: 100 }),
  noPlayReason: varchar("no_play_reason", { length: 100 }), // null = eligible
  confidence: varchar("confidence", { length: 20 }),        // high/medium/low

  // Ceiling
  p99: numeric("p99"),                                                // mean + 2.33σ

  // Lifecycle
  modelVersion: varchar("model_version", { length: 20 }).default("v2"),
  expiresAt: timestamp("expires_at"),
  generatedAt: timestamp("generated_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("our_projections_unique").on(t.playerId, t.statType),
}));

export type OurProjection = typeof ourProjectionsTable.$inferSelect;
export type InsertOurProjection = typeof ourProjectionsTable.$inferInsert;
