import { pgTable, serial, integer, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { gamesTable } from "./games";

export const gameEnvironmentTable = pgTable("game_environment", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gamesTable.id),
  gameTotal: numeric("game_total"),
  impliedPace: numeric("implied_pace"),
  environmentScore: integer("environment_score"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("game_env_unique").on(t.gameId),
}));

export type GameEnvironment = typeof gameEnvironmentTable.$inferSelect;
export type InsertGameEnvironment = typeof gameEnvironmentTable.$inferInsert;
