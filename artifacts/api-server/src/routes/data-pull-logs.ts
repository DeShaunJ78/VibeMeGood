import { Router } from "express";
import { db } from "@workspace/db";
import { dataPullLogsTable } from "@workspace/db/schema";
import { eq, and, desc, type SQL } from "drizzle-orm";

const router = Router();

router.get("/data-pull-logs", async (req, res) => {
  try {
    const { provider, status, limit } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (provider) conditions.push(eq(dataPullLogsTable.provider, provider));
    if (status) conditions.push(eq(dataPullLogsTable.status, status));

    const logs = conditions.length
      ? await db.select().from(dataPullLogsTable).where(and(...conditions)).orderBy(desc(dataPullLogsTable.startedAt))
      : await db.select().from(dataPullLogsTable).orderBy(desc(dataPullLogsTable.startedAt));

    res.json(limit ? logs.slice(0, Number(limit)) : logs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
