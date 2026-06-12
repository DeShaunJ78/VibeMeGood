import { pgTable, serial, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const pitcherProfilesTable = pgTable("pitcher_profiles", {
  id: serial("id").primaryKey(),
  playerName: varchar("player_name", { length: 150 }).notNull(),
  hand: varchar("hand", { length: 1 }),   // 'L' | 'R' | null when unknown
  sport: varchar("sport", { length: 10 }).notNull().default("MLB"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  nameIdx: uniqueIndex("pitcher_profiles_name_sport_idx").on(t.playerName, t.sport),
}));

export type PitcherProfile = typeof pitcherProfilesTable.$inferSelect;
export type InsertPitcherProfile = typeof pitcherProfilesTable.$inferInsert;
