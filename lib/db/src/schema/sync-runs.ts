import { pgTable, serial, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";

export const syncRunsTable = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  jobName: varchar("job_name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  recordsProcessed: integer("records_processed"),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
});

export type SyncRun = typeof syncRunsTable.$inferSelect;
export type InsertSyncRun = typeof syncRunsTable.$inferInsert;
