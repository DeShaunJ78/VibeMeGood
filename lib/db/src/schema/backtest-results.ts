import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const backtestResultsTable = pgTable("backtest_results", {
  id: serial("id").primaryKey(),
  runAt: timestamp("run_at").notNull().defaultNow(),
  series: integer("series").notNull(),
  predictions: integer("predictions").notNull(),
  result: jsonb("result").notNull(),
});

export type BacktestResultRow = typeof backtestResultsTable.$inferSelect;
export type InsertBacktestResult = typeof backtestResultsTable.$inferInsert;
