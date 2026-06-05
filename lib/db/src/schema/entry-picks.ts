import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entryPicksTable = pgTable("entry_picks", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").notNull(),
  ppLineId: integer("pp_line_id"),
  // Nullable: manually logged slips reference players by free-typed name
  // (playerName) rather than a seeded player row.
  playerId: integer("player_id"),
  playerName: text("player_name"),
  gameId: integer("game_id"),
  statType: text("stat_type").notNull(),
  direction: text("direction").notNull(), // more | less
  lineValue: numeric("line_value").notNull(),
  lineType: text("line_type").notNull(),
  yourProjection: numeric("your_projection"),
  projectionGap: numeric("projection_gap"),
  result: text("result").notNull().default("pending"), // pending | hit | miss | dnp | push
  gradedBy: text("graded_by"), // "auto" | "manual" | null (null = not yet graded / legacy)
  gradedAt: timestamp("graded_at"), // when the pick was last graded (auto or manual)
  closingLine: numeric("closing_line"),
  clv: numeric("clv"),
  // Edge + tier snapshot — frozen at log time so Journal/Review analysis
  // reflects the model's confidence at the moment the bet was made.
  snapshotEdgeScore: numeric("snapshot_edge_score"),
  snapshotTier: text("snapshot_tier"), // A | B | C | D
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEntryPickSchema = createInsertSchema(entryPicksTable).omit({ id: true, createdAt: true });
export type InsertEntryPick = z.infer<typeof insertEntryPickSchema>;
export type EntryPick = typeof entryPicksTable.$inferSelect;
