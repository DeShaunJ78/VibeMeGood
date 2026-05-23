import { Router } from "express";
import { db } from "@workspace/db";
import { dataPullLogsTable, alertsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

async function runSync(
  provider: string,
  jobName: string,
  fn: () => Promise<{ recordsProcessed: number }>,
  res: any,
) {
  const [log] = await db.insert(dataPullLogsTable).values({
    provider,
    jobName,
    status: "running",
    startedAt: new Date(),
  }).returning();

  res.json({ status: "started", logId: log.id });

  try {
    const result = await fn();
    await db.update(dataPullLogsTable)
      .set({ status: "success", recordsProcessed: result.recordsProcessed, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, `Sync failed: ${jobName}`);
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage: errorMsg, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    await db.insert(alertsTable).values({
      type: "sync_failure",
      severity: "warning",
      title: `Sync Failed: ${jobName}`,
      message: `${provider} sync failed: ${errorMsg}`,
    });
  }
}

async function syncPpLinesImpl() {
  await new Promise(r => setTimeout(r, 500));
  return { recordsProcessed: 0 };
}
async function syncInjuriesImpl() {
  await new Promise(r => setTimeout(r, 400));
  return { recordsProcessed: 0 };
}
async function syncExternalOddsImpl() {
  await new Promise(r => setTimeout(r, 600));
  return { recordsProcessed: 0 };
}
async function syncProjectionsImpl() {
  await new Promise(r => setTimeout(r, 700));
  return { recordsProcessed: 0 };
}
async function syncScoresImpl() {
  await new Promise(r => setTimeout(r, 300));
  return { recordsProcessed: 0 };
}

router.post("/sync/pp-lines", async (req, res) => {
  await runSync("prizepicks", "sync-pp-lines", syncPpLinesImpl, res);
});

router.post("/sync/injuries", async (req, res) => {
  await runSync("injury-news", "sync-injuries", syncInjuriesImpl, res);
});

router.post("/sync/external-odds", async (req, res) => {
  await runSync("external-odds", "sync-external-odds", syncExternalOddsImpl, res);
});

router.post("/sync/projections", async (req, res) => {
  await runSync("projections", "sync-projections", syncProjectionsImpl, res);
});

router.post("/sync/scores", async (req, res) => {
  await runSync("prizepicks", "sync-scores", syncScoresImpl, res);
});

export default router;
