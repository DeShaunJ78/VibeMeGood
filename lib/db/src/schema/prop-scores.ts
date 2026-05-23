import { pgTable, serial, integer, numeric, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const propScoresTable = pgTable("prop_scores", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  gameId: integer("game_id"),
  statType: text("stat_type").notNull(),
  ppLineId: integer("pp_line_id").notNull(),
  edgeScore: numeric("edge_score").notNull(),
  stabilityScore: numeric("stability_score").notNull(),
  marketSupportScore: numeric("market_support_score").notNull(),
  riskScore: numeric("risk_score").notNull(),
  finalScore: numeric("final_score").notNull(),
  actionTag: text("action_tag").notNull(), // PLAY | WATCH | PASS
  reasoning: jsonb("reasoning"),
  scoredAt: timestamp("scored_at").notNull(),
});

export const insertPropScoreSchema = createInsertSchema(propScoresTable).omit({ id: true });
export type InsertPropScore = z.infer<typeof insertPropScoreSchema>;
export type PropScore = typeof propScoresTable.$inferSelect;
