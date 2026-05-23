import { Router } from "express";
import { db } from "@workspace/db";
import { userSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const DEFAULT_USER_ID = "default";

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
