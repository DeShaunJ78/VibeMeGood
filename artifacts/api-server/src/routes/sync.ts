import { Router } from "express";
import { db } from "@workspace/db";
import { dataPullLogsTable, alertsTable, syncRunsTable, playersTable, injuriesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { broadcastSyncStatus, broadcast } from "../lib/sse";
import { syncPpLines } from "../lib/sync/prizepicks";
import { syncExternalOdds, recalcPropScores } from "../lib/sync/external-odds";
import { computeAllProjections } from "../lib/projection/compute";
import { computeStreaks } from "../lib/sync/streaks";
import { computeAllVarianceScores } from "../lib/variance";
import { syncFatigueData } from "../lib/sync/fatigue";
import { syncInjuries } from "../lib/sync/injuries";
import { syncProjections } from "../lib/projections/sync";
import { syncNflAdvancedMetrics } from "../lib/sync/nfl-advanced";

const router = Router();

async function runSync(
  provider: string,
  jobName: string,
  fn: () => Promise<number>,
  res: any,
) {
  const [log] = await db.insert(dataPullLogsTable).values({
    provider,
    jobName,
    status: "running",
    startedAt: new Date(),
  }).returning();

  const [syncRun] = await db.insert(syncRunsTable).values({
    jobName,
    status: "running",
    startedAt: new Date(),
  }).returning();

  res.json({ status: "started", logId: log.id });
  broadcastSyncStatus(jobName, "running");

  try {
    const recordsProcessed = await fn();
    await db.update(dataPullLogsTable)
      .set({ status: "success", recordsProcessed, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    await db.update(syncRunsTable)
      .set({ status: "success", recordsProcessed, finishedAt: new Date() })
      .where(eq(syncRunsTable.id, syncRun.id));
    broadcastSyncStatus(jobName, "success", `${recordsProcessed} records`);
    logger.info({ provider, jobName, recordsProcessed }, "Sync OK");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, `Sync failed: ${jobName}`);
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    await db.update(syncRunsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(syncRunsTable.id, syncRun.id));
    broadcastSyncStatus(jobName, "error", errorMessage);
    await db.insert(alertsTable).values({
      type: "sync_failure",
      severity: "warning",
      title: `Sync Failed: ${jobName}`,
      message: `${provider} sync failed: ${errorMessage}`,
    });
  }
}

async function syncProjectionsImpl(): Promise<number> {
  const n = await computeAllProjections();
  await recalcPropScores();
  await computeStreaks();
  return n;
}

async function syncInjuriesImpl(): Promise<number> {
  return syncInjuries();
}

async function syncScoresImpl(): Promise<number> {
  return 0;
}

router.post("/sync/pp-lines", async (req, res) => {
  await runSync("prizepicks", "pp-lines", syncPpLines, res);
});

router.post("/sync/injuries", async (req, res) => {
  await runSync("injury-news", "sync-injuries", syncInjuriesImpl, res);
});

router.post("/sync/external-odds", async (req, res) => {
  await runSync("the-odds-api", "external-odds", syncExternalOdds, res);
});

router.post("/sync/projections", async (req, res) => {
  await runSync("nba-stats", "projections", syncProjectionsImpl, res);
});

router.post("/sync/scores", async (req, res) => {
  await runSync("prizepicks", "sync-scores", syncScoresImpl, res);
});

router.post("/sync/fatigue", async (req, res) => {
  await runSync("internal", "fatigue", syncFatigueData, res);
});

router.post("/sync/variance", async (req, res) => {
  await runSync("internal", "variance", computeAllVarianceScores, res);
});

// Admin: sync NFL advanced metrics (snap counts + player stats) from nflverse
router.post("/admin/sync/nfl-advanced", async (req, res) => {
  const [log] = await db.insert(dataPullLogsTable).values({
    provider: "nflverse",
    jobName: "nfl-advanced-metrics",
    status: "running",
    startedAt: new Date(),
  }).returning();

  res.json({ status: "started", logId: log.id });

  try {
    const totalUpserted = await syncNflAdvancedMetrics();
    await db.update(dataPullLogsTable)
      .set({ status: "success", recordsProcessed: totalUpserted, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    req.log.info({ totalUpserted }, "NFL advanced metrics sync OK");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "NFL advanced metrics sync failed");
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
  }
});

// Admin: sync FP/NHL projections for one or all sports
router.post("/admin/sync/projections", async (req, res) => {
  const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
  const [log] = await db.insert(dataPullLogsTable).values({
    provider: "fantasypros",
    jobName: "projections",
    status: "running",
    startedAt: new Date(),
  }).returning();

  // Respond immediately; work runs async
  res.json({ status: "started", logId: log.id });

  try {
    const results = await syncProjections(sport);
    const totalScraped  = results.reduce((s, r) => s + r.scraped, 0);
    const totalMatched  = results.reduce((s, r) => s + r.matched, 0);
    const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
    await db.update(dataPullLogsTable)
      .set({ status: "success", recordsProcessed: totalUpserted, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    req.log.info({ totalScraped, totalMatched, totalUpserted, sport }, "FP projection sync OK");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "FP projection sync failed");
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
  }
});

// Force sync all — triggers PP lines + external odds sequentially
router.post("/sync/all", async (req, res) => {
  res.json({ status: "started", message: "All syncs initiated" });
  broadcastSyncStatus("all", "running");

  const jobs: Array<{ name: string; provider: string; fn: () => Promise<number> }> = [
    { name: "pp-lines",    provider: "prizepicks",    fn: syncPpLines },
    { name: "injuries",    provider: "injury-news",   fn: syncInjuriesImpl },
    { name: "external-odds", provider: "the-odds-api", fn: syncExternalOdds },
    { name: "projections", provider: "nba-stats",     fn: syncProjectionsImpl },
    { name: "variance",    provider: "internal",      fn: computeAllVarianceScores },
    { name: "fatigue",     provider: "internal",      fn: syncFatigueData },
  ];

  for (const job of jobs) {
    const [log] = await db.insert(dataPullLogsTable).values({
      provider: job.provider,
      jobName: job.name,
      status: "running",
      startedAt: new Date(),
    }).returning();
    const [syncRun] = await db.insert(syncRunsTable).values({
      jobName: job.name,
      status: "running",
      startedAt: new Date(),
    }).returning();

    broadcastSyncStatus(job.name, "running");
    try {
      const n = await job.fn();
      await db.update(dataPullLogsTable)
        .set({ status: "success", recordsProcessed: n, finishedAt: new Date() })
        .where(eq(dataPullLogsTable.id, log.id));
      await db.update(syncRunsTable)
        .set({ status: "success", recordsProcessed: n, finishedAt: new Date() })
        .where(eq(syncRunsTable.id, syncRun.id));
      broadcastSyncStatus(job.name, "success", `${n} records`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      await db.update(dataPullLogsTable)
        .set({ status: "error", errorMessage: msg, finishedAt: new Date() })
        .where(eq(dataPullLogsTable.id, log.id));
      await db.update(syncRunsTable)
        .set({ status: "error", errorMessage: msg, finishedAt: new Date() })
        .where(eq(syncRunsTable.id, syncRun.id));
      broadcastSyncStatus(job.name, "error", msg);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  broadcastSyncStatus("all", "success", "All syncs complete");
});

export default router;
