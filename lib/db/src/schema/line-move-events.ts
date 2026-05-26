import { pgTable, serial, integer, numeric, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { ppLinesTable } from "./pp-lines";

export const lineMoveEventsTable = pgTable("line_move_events", {
  id: serial("id").primaryKey(),
  ppLineId: integer("pp_line_id").references(() => ppLinesTable.id),
  bookName: varchar("book_name", { length: 100 }),
  prevLine: numeric("prev_line"),
  newLine: numeric("new_line"),
  moveSize: numeric("move_size"),
  moveDirection: varchar("move_direction", { length: 10 }),
  sequenceNumber: integer("sequence_number"),
  capturedAt: timestamp("captured_at").defaultNow(),
  sharpSignal: varchar("sharp_signal", { length: 10 }),
  sharpConfidence: varchar("sharp_confidence", { length: 10 }),
  sharpExplanation: text("sharp_explanation"),
});

export type LineMoveEvent = typeof lineMoveEventsTable.$inferSelect;
export type InsertLineMoveEvent = typeof lineMoveEventsTable.$inferInsert;
