import { pgTable, serial, integer, numeric, varchar, timestamp } from "drizzle-orm/pg-core";
import { entryPicksTable } from "./entry-picks";
import { ppLinesTable } from "./pp-lines";

export const clvRecordsTable = pgTable("clv_records", {
  id: serial("id").primaryKey(),
  entryPickId: integer("entry_pick_id").references(() => entryPicksTable.id),
  ppLineId: integer("pp_line_id").references(() => ppLinesTable.id),
  lockedLine: numeric("locked_line").notNull(),
  closingLine: numeric("closing_line"),
  clv: numeric("clv"),
  direction: varchar("direction", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ClvRecord = typeof clvRecordsTable.$inferSelect;
export type InsertClvRecord = typeof clvRecordsTable.$inferInsert;
