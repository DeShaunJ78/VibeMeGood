import { pgTable, serial, varchar, numeric, integer, boolean, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const sessionLogsTable = pgTable("session_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  sessionDate: date("session_date").notNull(),
  totalStaked: numeric("total_staked").default("0"),
  totalPnl: numeric("total_pnl").default("0"),
  entriesPlaced: integer("entries_placed").default(0),
  isLocked: boolean("is_locked").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("session_unique").on(t.userId, t.sessionDate),
}));

export type SessionLog = typeof sessionLogsTable.$inferSelect;
export type InsertSessionLog = typeof sessionLogsTable.$inferInsert;
