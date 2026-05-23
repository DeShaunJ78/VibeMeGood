import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const payoutConfigTable = pgTable("payout_config", {
  id: serial("id").primaryKey(),
  providerName: text("provider_name").notNull(),
  entryType: text("entry_type").notNull(), // power | flex
  pickCount: integer("pick_count").notNull(),
  config: jsonb("config").notNull(),
  effectiveAt: timestamp("effective_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPayoutConfigSchema = createInsertSchema(payoutConfigTable).omit({ id: true, createdAt: true });
export type InsertPayoutConfig = z.infer<typeof insertPayoutConfigSchema>;
export type PayoutConfig = typeof payoutConfigTable.$inferSelect;
