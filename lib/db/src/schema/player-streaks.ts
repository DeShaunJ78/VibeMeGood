import { pgTable, serial, integer, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const playerStreaksTable = pgTable("player_streaks", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id),
  statType: varchar("stat_type", { length: 100 }).notNull(),
  currentStreak: integer("current_streak").default(0),
  streakType: varchar("streak_type", { length: 10 }),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("streak_unique").on(t.playerId, t.statType),
}));

export type PlayerStreak = typeof playerStreaksTable.$inferSelect;
export type InsertPlayerStreak = typeof playerStreaksTable.$inferInsert;
