import { pgTable, serial, text, integer, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const nflAdvancedMetricsTable = pgTable("nfl_advanced_metrics", {
  id:           serial("id").primaryKey(),
  playerName:   text("player_name").notNull(),
  team:         text("team").notNull(),
  position:     text("position"),
  season:       integer("season").notNull(),
  week:         integer("week"),
  snapCount:    integer("snap_count"),
  snapPct:      numeric("snap_pct", { precision: 5, scale: 4 }),
  targetShare:  numeric("target_share", { precision: 5, scale: 4 }),
  airYards:     numeric("air_yards", { precision: 7, scale: 2 }),
  airYardsShare: numeric("air_yards_share", { precision: 8, scale: 4 }),
  wopr:         numeric("wopr", { precision: 8, scale: 4 }),
  racr:         numeric("racr", { precision: 8, scale: 4 }),
  targets:      integer("targets"),
  computedAt:   timestamp("computed_at").defaultNow().notNull(),
}, (table) => [
  unique("nfl_adv_unique").on(table.playerName, table.team, table.season, table.week),
]);

export const insertNflAdvancedMetricSchema = createInsertSchema(nflAdvancedMetricsTable).omit({ id: true, computedAt: true });
export type InsertNflAdvancedMetric = z.infer<typeof insertNflAdvancedMetricSchema>;
export type NflAdvancedMetric = typeof nflAdvancedMetricsTable.$inferSelect;
