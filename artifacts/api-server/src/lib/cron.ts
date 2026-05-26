import cron from "node-cron";
import { db } from "@workspace/db";
import { dataPullLogsTable, alertsTable, ppLinesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { syncPpLines } from "./sync/prizepicks";
import { syncExternalOdds, recalcPropScores } from "./sync/external-odds";
import { computeAllProjections } from "./projection/compute";
import { computeStreaks } from "./sync/streaks";
import { computeAllVarianceScores } from "./variance";
import { syncFatigueData } from "./sync/fatigue";
import { syncInjuries } from "./sync/injuries";
import { syncProjections } from "./projections/sync";

async function logPull(provider: string, jobName: string, fn: () => Promise<number>) {
  const [log] = await db.insert(dataPullLogsTable).values({
    provider,
    jobName,
    status: "running",
    startedAt: new Date(),
  }).returning();

  try {
    const recordsProcessed = await fn();
    await db.update(dataPullLogsTable)
      .set({ status: "success", recordsProcessed, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    logger.info({ provider, jobName, recordsProcessed }, "Sync completed");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, provider, jobName }, "Sync failed");
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    await db.insert(alertsTable).values({
      type: "sync_failure",
      severity: "warning",
      title: `Sync Failed: ${jobName}`,
      message: `${provider} sync failed: ${errorMessage}`,
    });
  }
}

export function startCronJobs() {
  // PP lines every 10 minutes
  cron.schedule("*/10 * * * *", () =>
    logPull("prizepicks", "pp-lines", syncPpLines)
  );

  // Injuries every 20 minutes
  cron.schedule("*/20 * * * *", () =>
    logPull("injury-news", "injuries", syncInjuries)
  );

  // External odds every 20 minutes
  cron.schedule("*/20 * * * *", () =>
    logPull("the-odds-api", "external-odds", syncExternalOdds)
  );

  // Projections at 6 AM, 11 AM, and 2 PM daily
  const projectionsJob = () =>
    logPull("nba-stats", "projections", async () => {
      const n = await computeAllProjections();
      await recalcPropScores();
      await computeStreaks();
      return n;
    });
  cron.schedule("0 6 * * *",  projectionsJob);
  cron.schedule("0 11 * * *", projectionsJob);
  cron.schedule("0 14 * * *", projectionsJob);

  // FP/NHL projection scraper at 7 AM, 11 AM, and 2 PM daily
  const fpProjectionsJob = () =>
    logPull("fantasypros", "projections", async () => {
      const results = await syncProjections();
      return results.reduce((s, r) => s + r.upserted, 0);
    });
  cron.schedule("0 7 * * *",  fpProjectionsJob);
  cron.schedule("0 11 * * *", fpProjectionsJob);
  cron.schedule("0 14 * * *", fpProjectionsJob);

  // Variance scores at 6:30 AM (after projections)
  cron.schedule("30 6 * * *", () =>
    logPull("internal", "variance-scores", computeAllVarianceScores)
  );

  // Fatigue data at 6:30 AM (after projections populate game logs)
  cron.schedule("30 6 * * *", () =>
    logPull("internal", "fatigue", syncFatigueData)
  );

  // Fatigue re-run at noon to catch late lineup news
  cron.schedule("0 12 * * *", () =>
    logPull("internal", "fatigue", syncFatigueData)
  );

  // Alert: stale data check every hour
  cron.schedule("0 * * * *", async () => {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const staleLines = await db.select()
        .from(ppLinesTable)
        .where(and(eq(ppLinesTable.isActive, true)));

      const actuallyStale = staleLines.filter(l => l.updatedAt < twoHoursAgo);
      if (actuallyStale.length > 10) {
        await db.insert(alertsTable).values({
          type: "stale_data",
          severity: "warning",
          title: "Stale Line Data",
          message: `${actuallyStale.length} active lines haven't been updated in over 2 hours.`,
        });
      }
    } catch (err) {
      logger.error({ err }, "Stale data check failed");
    }
  });

  logger.info("Cron jobs started");
}
