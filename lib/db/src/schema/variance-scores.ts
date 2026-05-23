import { pgTable, serial, integer, varchar, numeric, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { ppLinesTable } from "./pp-lines";
import { playersTable } from "./players";

export const varianceScoresTable = pgTable("variance_scores", {
  id: serial("id").primaryKey(),
  ppLineId: integer("pp_line_id").references(() => ppLinesTable.id),
  playerId: integer("player_id").references(() => playersTable.id),
  statType: varchar("stat_type", { length: 100 }).notNull(),
  fatigueScore: integer("fatigue_score"),
  environmentScore: integer("environment_score"),
  usageScore: integer("usage_score"),
  matchupScore: integer("matchup_score"),
  narrativeScore: integer("narrative_score"),
  blowoutRisk: integer("blowout_risk"),
  volatilityRating: varchar("volatility_rating", { length: 20 }),
  ceilingRating: integer("ceiling_rating"),
  floorRating: integer("floor_rating"),
  evModifier: numeric("ev_modifier").default("0"),
  signals: jsonb("signals"),
  warnings: jsonb("warnings"),
  whyItMoves: text("why_it_moves"),
  computedAt: timestamp("computed_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("variance_scores_unique").on(t.ppLineId),
}));

export type VarianceScore = typeof varianceScoresTable.$inferSelect;
export type InsertVarianceScore = typeof varianceScoresTable.$inferInsert;
