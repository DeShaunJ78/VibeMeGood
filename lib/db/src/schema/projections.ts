import { pgTable, serial, integer, numeric, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectionsTable = pgTable("projections", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  gameId: integer("game_id"),
  statType: text("stat_type").notNull(),
  projectedValue: numeric("projected_value").notNull(),
  floorValue: numeric("floor_value"),
  medianValue: numeric("median_value"),
  ceilingValue: numeric("ceiling_value"),
  confidenceScore: numeric("confidence_score"),
  projectionSource: text("projection_source").notNull(),
  featureSnapshot: jsonb("feature_snapshot"),
  generatedAt: timestamp("generated_at").notNull(),
});

export const insertProjectionSchema = createInsertSchema(projectionsTable).omit({ id: true });
export type InsertProjection = z.infer<typeof insertProjectionSchema>;
export type Projection = typeof projectionsTable.$inferSelect;
