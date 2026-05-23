import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const DEFAULT_USER_ID = "default";

const UserSettingsSchema = z.object({
  bankroll: z.number().positive().optional(),
  unitSize: z.number().positive().optional(),
  kellyFraction: z.number().min(0.05).max(1).optional(),
  dailyLossLimit: z.number().positive().nullable().optional(),
  varianceIntelEnabled: z.boolean().optional(),
  showFatigueSignal: z.boolean().optional(),
  showBlowoutRisk: z.boolean().optional(),
  showUsageDelta: z.boolean().optional(),
  showMatchupScore: z.boolean().optional(),
  showEnvironmentScore: z.boolean().optional(),
  optimizerMode: z.string().optional(),
  experimentalMode: z.boolean().optional(),
}).passthrough();

router.get("/user-settings", async (req, res) => {
  try {
    let [settings] = await db.select().from(userSettingsTable)
      .where(eq(userSettingsTable.userId, DEFAULT_USER_ID));
    if (!settings) {
      [settings] = await db.insert(userSettingsTable)
        .values({ userId: DEFAULT_USER_ID })
        .returning();
    }
    res.json(settings);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.patch("/user-settings", async (req, res) => {
  try {
    const validation = UserSettingsSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: "Invalid input", issues: validation.error.issues });
      return;
    }
    const patch = req.body as Partial<typeof userSettingsTable.$inferInsert>;
    // Ensure record exists
    const [existing] = await db.select({ id: userSettingsTable.id })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, DEFAULT_USER_ID));
    if (!existing) {
      await db.insert(userSettingsTable).values({ userId: DEFAULT_USER_ID });
    }
    const [updated] = await db.update(userSettingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userSettingsTable.userId, DEFAULT_USER_ID))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

export default router;
