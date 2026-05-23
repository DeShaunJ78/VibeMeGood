import cron from "node-cron";
import { db } from "@workspace/db";
import { dataPullLogsTable, alertsTable, ppLinesTable, propScoresTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

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
  // Refresh line snapshot every 15 minutes during typical sports hours
  cron.schedule("*/15 * * * *", async () => {
    await logPull("prizepicks", "line-snapshot", async () => {
      // Stub: In production, pull from PrizePicks API and upsert pp_lines + pp_line_history
      return 0;
    });
  });

  // Injury feed every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    await logPull("injury-news", "injury-feed", async () => {
      return 0;
    });
  });

  // External odds every 20 minutes
  cron.schedule("*/20 * * * *", async () => {
    await logPull("external-odds", "external-odds", async () => {
      return 0;
    });
  });

  // Score/result refresh every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    await logPull("prizepicks", "score-refresh", async () => {
      return 0;
    });
  });

  // Daily projection refresh at 6 AM
  cron.schedule("0 6 * * *", async () => {
    await logPull("projections", "daily-projections", async () => {
      return 0;
    });
  });

  // Alert: stale data warning — check every hour if pp-lines haven't been updated in 2h
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
