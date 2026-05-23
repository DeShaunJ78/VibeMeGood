import { pgTable, serial, integer, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const playerIdMappingTable = pgTable("player_id_mapping", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => playersTable.id),
  source: varchar("source", { length: 50 }).notNull(),
  externalId: varchar("external_id", { length: 100 }).notNull(),
  externalName: varchar("external_name", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("player_id_mapping_unique").on(t.playerId, t.source),
}));

export type PlayerIdMapping = typeof playerIdMappingTable.$inferSelect;
export type InsertPlayerIdMapping = typeof playerIdMappingTable.$inferInsert;
