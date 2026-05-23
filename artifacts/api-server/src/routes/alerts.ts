import { Router } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db/schema";
import { eq, and, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/alerts", async (req, res) => {
  try {
    const { isRead, severity } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (isRead !== undefined) conditions.push(eq(alertsTable.isRead, isRead === "true"));
    if (severity) conditions.push(eq(alertsTable.severity, severity));

    const alerts = conditions.length
      ? await db.select().from(alertsTable).where(and(...conditions))
      : await db.select().from(alertsTable);
    res.json(alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/alerts/:id/read", async (req, res) => {
  try {
    const [alert] = await db.update(alertsTable)
      .set({ isRead: true })
      .where(eq(alertsTable.id, Number(req.params.id)))
      .returning();
    if (!alert) return void res.status(404).json({ error: "Alert not found" });
    res.json(alert);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/alerts/read-all", async (req, res) => {
  try {
    const result = await db.update(alertsTable).set({ isRead: true }).where(eq(alertsTable.isRead, false)).returning();
    res.json({ updated: result.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
