import { pgTable, serial, varchar, integer, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const probabilityCalibrationTable = pgTable("probability_calibration", {
  id: serial("id").primaryKey(),
  sport: varchar("sport", { length: 50 }).notNull(),
  statType: varchar("stat_type", { length: 100 }).notNull(),
  lineType: varchar("line_type", { length: 20 }).notNull(),
  edgeBucket: varchar("edge_bucket", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  sampleSize: integer("sample_size").default(0),
  hitCount: integer("hit_count").default(0),
  hitRate: numeric("hit_rate"),
  confidenceInterval: numeric("confidence_interval"),
  lastUpdated: timestamp("last_updated").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("prob_cal_unique").on(t.sport, t.statType, t.lineType, t.edgeBucket, t.direction),
}));

export type ProbabilityCalibration = typeof probabilityCalibrationTable.$inferSelect;
export type InsertProbabilityCalibration = typeof probabilityCalibrationTable.$inferInsert;
