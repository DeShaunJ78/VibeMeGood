import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dataPullLogsTable = pgTable("data_pull_logs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  jobName: text("job_name").notNull(),
  status: text("status").notNull(), // success | error | running
  recordsProcessed: integer("records_processed"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  errorMessage: text("error_message"),
});

export const insertDataPullLogSchema = createInsertSchema(dataPullLogsTable).omit({ id: true });
export type InsertDataPullLog = z.infer<typeof insertDataPullLogSchema>;
export type DataPullLog = typeof dataPullLogsTable.$inferSelect;
