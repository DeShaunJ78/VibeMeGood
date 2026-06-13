import cron from "node-cron";
import { db } from "@workspace/db";
import {
  dataPullLogsTable, alertsTable, ppLinesTable, gamesTable,
  lineMoveEventsTable, externalLinesTable, propScoresTable, syncRunsTable,
} from "@workspace/db/schema";
import { eq, and, lt, gte, lte, desc } from "drizzle-orm";
import { logger } from "./logger";
import { syncExternalOdds, recalcPropScores } from "./sync/external-odds";
import { computeAllProjections } from "./projection/compute";
import { computeStreaks } from "./sync/streaks";
import { computeAllVarianceScores } from "./variance";
import { syncFatigueData } from "./sync/fatigue";
import { syncInjuries } from "./sync/injuries";
import { syncProjections } from "./projections/sync";
import { syncNflAdvancedMetrics } from "./sync/nfl-advanced";
import { syncGameSchedule, syncMlbProbableStarters } from "./sync/games";
import { syncGameOdds } from "./sync/game-odds";
import { syncWeather } from "./sync/weather";
import { computeMatchupHistory } from "./sync/matchup-history";
import { backfillHistoricalStats } from "./sync/historical-stats";
import { calibrationJob } from "../scripts/calibration-job";
import { gradePicksJob } from "./sync/auto-grade";

export let preLockActive = false;
export function isPreLockActive(): boolean { return preLockActive; }

// ---------------------------------------------------------------------------
// In-memory circuit breaker — prevents hammering a dead provider every tick.
// ---------------------------------------------------------------------------
interface CircuitState {
  consecutiveFails: number;
  backoffUntil: number;
}
const circuit: Record<string, CircuitState> = {};

function getCircuit(provider: string): CircuitState {
  if (!circuit[provider]) circuit[provider] = { consecutiveFails: 0, backoffUntil: 0 };
  return circuit[provider];
}

// Thresholds: PP gets stricter backoff since 403s are long-lived blocks.
const CIRCUIT_CONFIG: Record<string, { threshold: number; backoffMs: number }> = {
  prizepicks: { threshold: 3, backoffMs: 30 * 60 * 1000 },  // 3 fails → 30 min backoff
  default:    { threshold: 5, backoffMs: 10 * 60 * 1000 },  // 5 fails → 10 min backoff
};

function circuitIsOpen(provider: string): boolean {
  const cb = getCircuit(provider);
  if (cb.backoffUntil > Date.now()) {
    const remainingMin = Math.ceil((cb.backoffUntil - Date.now()) / 60_000);
    logger.info({ provider, remainingMin }, "Circuit breaker open — skipping sync tick");
    return true;
  }
  return false;
}

function recordCircuitSuccess(provider: string) {
  const cb = getCircuit(provider);
  cb.consecutiveFails = 0;
  cb.backoffUntil = 0;
}

function recordCircuitFailure(provider: string) {
  const cb = getCircuit(provider);
  cb.consecutiveFails++;
  const cfg = CIRCUIT_CONFIG[provider] ?? CIRCUIT_CONFIG.default;
  if (cb.consecutiveFails >= cfg.threshold) {
    cb.backoffUntil = Date.now() + cfg.backoffMs;
    logger.warn(
      { provider, consecutiveFails: cb.consecutiveFails, backoffMin: cfg.backoffMs / 60_000 },
      "Circuit breaker tripped — backing off",
    );
  }
}

// ---------------------------------------------------------------------------
// logPull — wraps every cron sync with logging + circuit breaker
// ---------------------------------------------------------------------------
export async function logPull(provider: string, jobName: string, fn: () => Promise<number>) {
  if (circuitIsOpen(provider)) return;

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
    recordCircuitSuccess(provider);
    logger.info({ provider, jobName, recordsProcessed }, "Sync completed");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, provider, jobName }, "Sync failed");
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    recordCircuitFailure(provider);

    // Only insert a sync_failure alert if we haven't already fired one for this
    // provider in the last 30 minutes — prevents alert spam during outages.
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const [recentAlert] = await db
      .select({ id: alertsTable.id })
      .from(alertsTable)
      .where(and(
        eq(alertsTable.type, "sync_failure"),
        gte(alertsTable.createdAt, thirtyMinAgo),
      ))
      .limit(1);

    if (!recentAlert) {
      await db.insert(alertsTable).values({
        type: "sync_failure",
        severity: "warning",
        title: `Sync Failed: ${jobName}`,
        message: `${provider} sync failed: ${errorMessage}`,
      });
    }
  }
}

export function startCronJobs() {
  // NOTE: There is intentionally no scheduled PrizePicks sync. api.prizepicks.com
  // is behind PerimeterX and every server-side pull returns 403, so an automatic
  // cron only spams error logs and keeps the data-health dot red. The browser
  // copy-paste import (POST /api/sync/pp-lines-import) is the sole working path.

  // Injuries every 20 minutes
  cron.schedule("*/20 * * * *", () =>
    logPull("injury-news", "injuries", syncInjuries)
  );

  // External odds every 3 hours. Pre-lock (2h-before-game trigger above) already
  // covers time-critical refreshes — the routine cron just keeps the board warm
  // between games. Cutting from hourly → every-3h saves ~67% of Odds API credits.
  cron.schedule("0 */3 * * *", () =>
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
    logPull("internal", "variance", computeAllVarianceScores)
  );
  cron.schedule("30 18 * * *", () =>
    logPull("internal", "variance", computeAllVarianceScores)
  );

  // Fatigue data at 6:35 AM (after projections populate game logs)
  cron.schedule("35 6 * * *", () =>
    logPull("internal", "fatigue", syncFatigueData)
  );

  // Fatigue re-run at noon to catch late lineup news
  cron.schedule("0 12 * * *", () =>
    logPull("internal", "fatigue", syncFatigueData)
  );

  // Alert: stale data check every hour — deduplicated so it only fires once
  // per stale window rather than every hour for the full duration of an outage.
  cron.schedule("0 * * * *", async () => {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const staleLines = await db.select()
        .from(ppLinesTable)
        .where(and(eq(ppLinesTable.isActive, true)));

      const actuallyStale = staleLines.filter(l => l.updatedAt < twoHoursAgo);
      if (actuallyStale.length > 10) {
        // Only insert if there isn't already a stale_data alert from the last 2 hours.
        const [existing] = await db
          .select({ id: alertsTable.id })
          .from(alertsTable)
          .where(and(
            eq(alertsTable.type, "stale_data"),
            gte(alertsTable.createdAt, twoHoursAgo),
          ))
          .limit(1);

        if (!existing) {
          await db.insert(alertsTable).values({
            type: "stale_data",
            severity: "warning",
            title: "Stale Line Data",
            message: `${actuallyStale.length} active lines haven't been updated in over 2 hours. Manual sync recommended.`,
          });
        }
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
        logger.info("Pre-lock window detected — triggering urgent sync (injuries + odds)");
        // Pre-lock bypasses circuit breaker — these are time-critical. PP lines are
        // not pulled here: server-side PP fetches always 403 (PerimeterX).
        await Promise.all([
          syncInjuries(),
          logPull("the-odds-api", "external-odds", () => syncExternalOdds(true)),
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

  // MLB probable starters every 30 minutes — the MLB Stats API is free and
  // requires no auth. Starters are often confirmed only 1–2 hours before
  // first pitch, so polling at this cadence ensures the platoon / K-matchup /
  // pitcherForm factors always have current pitcher data when props lock.
  // Runs independently of the full schedule sync so a failed schedule pull
  // never blocks a starter update.  After each write, recalcPropScores
  // propagates the new pitcher signal into variance_scores.saberEvModifier so
  // lineup builds see it immediately.
  cron.schedule("*/30 * * * *", async () => {
    await logPull("mlb-stats", "mlb-starters", syncMlbProbableStarters);
    recalcPropScores().catch(err =>
      logger.warn({ err }, "recalcPropScores post-mlb-starters cron failed (non-critical)"),
    );
  });

  // Game odds (spread/total) every 6 hours — bulk /odds endpoint, ~2 credits/sport.
  // Lines move slowly enough that 4 pulls/day is plenty; pre-lock covers urgency.
  cron.schedule("15 */6 * * *", () =>
    logPull("the-odds-api", "game-odds", syncGameOdds)
  );

  // Weather (Open-Meteo, no key) at 6:40 AM + 4 PM — refresh kickoff forecasts.
  cron.schedule("40 6 * * *", () =>
    logPull("open-meteo", "weather", syncWeather)
  );
  cron.schedule("0 16 * * *", () =>
    logPull("open-meteo", "weather", syncWeather)
  );

  // NFL advanced metrics every Tuesday at 6 AM (after MNF finalizes)
  cron.schedule("0 6 * * 2", () =>
    logPull("nflverse", "nfl-advanced-metrics", syncNflAdvancedMetrics)
  );

  // Nightly game log sync at 2 AM — pulls current season results for NBA/MLB/NHL/NFL
  cron.schedule("0 2 * * *", () =>
    logPull("espn", "game-logs", async () => {
      const r = await backfillHistoricalStats({ nba: true, mlb: true, nhl: true, nfl: true });
      return r.total;
    })
  );

  // Auto-grade pending picks at 3:30 AM nightly — after game-logs (2 AM) and
  // cleanup (3 AM) have run. Fuzzy stat-type alias matching resolves abbreviation
  // mismatches (e.g. "PTS" ↔ "Points") before falling back to DNP inference.
  cron.schedule("30 3 * * *", () =>
    logPull("internal", "auto-grade-picks", gradePicksJob)
  );

  // Nightly matchup history rebuild at 4 AM (after game logs are updated)
  cron.schedule("0 4 * * *", () =>
    logPull("internal", "matchup-history", computeMatchupHistory)
  );

  // Weekly probability calibration on Sunday at 5 AM — rebuilds the empirical
  // edge→hit-rate table from settled lines so the morning projection runs blend
  // toward real outcomes. Runs after nightly game logs (2 AM) are fresh.
  cron.schedule("0 5 * * 0", () =>
    logPull("internal", "calibration", async () => {
      const r = await calibrationJob.runHistoricalCalibration();
      return r.calibrationRecords;
    })
  );

  // Nightly cleanup at 3 AM — prune transient tables, keep permanent data
  cron.schedule("0 3 * * *", async () => {
    try {
      const day90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      await db.delete(lineMoveEventsTable).where(lt(lineMoveEventsTable.capturedAt, day90));
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
