import { pgTable, serial, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const platformLinesTable = pgTable("platform_lines", {
  id:         serial("id").primaryKey(),
  playerName: text("player_name").notNull(),
  statType:   text("stat_type").notNull(),
  lineValue:  numeric("line_value").notNull(),
  platform:   text("platform").notNull(), // 'underdog' | 'pick6' | 'betr'
  syncedAt:   timestamp("synced_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("platform_lines_uniq").on(t.playerName, t.statType, t.platform),
}));

export const insertPlatformLineSchema = createInsertSchema(platformLinesTable).omit({ id: true });
export type InsertPlatformLine = z.infer<typeof insertPlatformLineSchema>;
export type PlatformLine = typeof platformLinesTable.$inferSelect;
