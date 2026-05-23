import { pgTable, serial, integer, numeric, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ppLineHistoryTable = pgTable("pp_line_history", {
  id: serial("id").primaryKey(),
  ppLineId: integer("pp_line_id").notNull(),
  lineValue: numeric("line_value").notNull(),
  lineType: text("line_type").notNull(),
  capturedAt: timestamp("captured_at").notNull(),
  metadata: jsonb("metadata"),
});

export const insertPpLineHistorySchema = createInsertSchema(ppLineHistoryTable).omit({ id: true });
export type InsertPpLineHistory = z.infer<typeof insertPpLineHistorySchema>;
export type PpLineHistory = typeof ppLineHistoryTable.$inferSelect;
