import cron from "node-cron";
import { db } from "@workspace/db";
import {
  dataPullLogsTable, alertsTable, ppLinesTable, gamesTable,
  lineMoveEventsTable, externalLinesTable, propScoresTable, syncRunsTable,
} from "@workspace/db/schema";
import { eq, and, lt, gte, lte } from "drizzle-orm";
import { logger } from "./logger";
import { syncPpLines } from "./sync/prizepicks";
import { syncExternalOdds, recalcPropScores } from "./sync/external-odds";
import { computeAllProjections } from "./projection/compute";
import { computeStreaks } from "./sync/streaks";
import { computeAllVarianceScores } from "./variance";
import { syncFatigueData } from "./sync/fatigue";
import { syncInjuries } from "./sync/injuries";
import { syncProjections } from "./projections/sync";
import { syncNflAdvancedMetrics } from "./sync/nfl-advanced";
import { syncGameSchedule } from "./sync/games";
import { computeMatchupHistory } from "./sync/matchup-history";
import { backfillHistoricalStats } from "./sync/historical-stats";

export let preLockActive = false;
export function isPreLockActive(): boolean { return preLockActive; }

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

  // External odds every 30 minutes
  cron.schedule("*/30 * * * *", () =>
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

  // Variance scores at 6:30 AM and 6:30 PM (after projections)
  cron.schedule("30 6 * * *", () =>
    logPull("internal", "variance-scores", computeAllVarianceScores)
  );
  cron.schedule("30 18 * * *", () =>
    logPull("internal", "variance-scores", computeAllVarianceScores)
  );

  // Fatigue data at 6:35 AM (after projections populate game logs)
  cron.schedule("35 6 * * *", () =>
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

  // Pre-lock scraper — runs every minute, triggers urgent sync when games start within 2 h
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const twoHoursOut = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const upcoming = await db
        .selectDistinct({ gameId: ppLinesTable.gameId })
        .from(ppLinesTable)
        .innerJoin(gamesTable, eq(gamesTable.id, ppLinesTable.gameId as never))
        .where(and(
          eq(ppLinesTable.isActive, true),
          gte(gamesTable.startTime, now),
          lte(gamesTable.startTime, twoHoursOut),
        ))
        .limit(1);
      const wasActive = preLockActive;
      preLockActive = upcoming.length > 0;
      if (preLockActive && !wasActive) {
        logger.info("Pre-lock window detected — triggering urgent sync (lines + injuries + odds)");
        await syncPpLines();
        // Also refresh injuries and odds so lineup decisions have fresh data.
        // syncExternalOdds(true) bypasses the 20-min cooldown for this urgent case.
        await Promise.all([
          syncInjuries(),
          syncExternalOdds(true),
        ]);
      }
    } catch (err) {
      logger.error({ err }, "Pre-lock scraper error");
    }
  });

  // Game schedule every 30 minutes
  cron.schedule("*/30 * * * *", () =>
    logPull("espn", "game-schedule", syncGameSchedule)
  );

  // NFL advanced metrics every Tuesday at 6 AM (after MNF finalizes)
  cron.schedule("0 6 * * 2", () =>
    logPull("nflverse", "nfl-advanced-metrics", syncNflAdvancedMetrics)
  );

  // Nightly game log sync at 2 AM — pulls current season results for NBA/MLB/NHL
  cron.schedule("0 2 * * *", () =>
    logPull("espn", "game-logs", async () => {
      const r = await backfillHistoricalStats({ nba: true, mlb: true, nhl: true, nfl: false });
      return r.total;
    })
  );

  // Nightly matchup history rebuild at 4 AM (after game logs are updated)
  cron.schedule("0 4 * * *", () =>
    logPull("internal", "matchup-history", computeMatchupHistory)
  );

  // Nightly cleanup at 3 AM — prune transient tables, keep permanent data
  cron.schedule("0 3 * * *", async () => {
    try {
      const day7  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
      const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      await db.delete(lineMoveEventsTable).where(lt(lineMoveEventsTable.capturedAt, day7));
      await db.delete(externalLinesTable).where(lt(externalLinesTable.pulledAt, day30));
      await db.delete(propScoresTable).where(lt(propScoresTable.scoredAt, day30));
      await db.delete(syncRunsTable).where(lt(syncRunsTable.startedAt, day30));

      logger.info("Nightly cleanup complete");
    } catch (err) {
      logger.error({ err }, "Nightly cleanup failed");
    }
  });

  logger.info("Cron jobs started");
}
