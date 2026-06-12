import { Router } from "express";
import { db } from "@workspace/db";
import { dataPullLogsTable, alertsTable, syncRunsTable, playersTable, injuriesTable, ppLinesTable, gamesTable, playerGameLogsTable, probabilityCalibrationTable, entryPicksTable, entriesTable } from "@workspace/db/schema";
import { eq, and, isNull, isNotNull, or, gte, lte, lt, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { broadcastSyncStatus, broadcast } from "../lib/sse";
import { gradePicksJob, getAutoGradeStats } from "../lib/sync/auto-grade";
import { processPpData } from "../lib/sync/prizepicks";
import { syncExternalOdds, recalcPropScores } from "../lib/sync/external-odds";
import { computeAllProjections } from "../lib/projection/compute";
import { computeStreaks } from "../lib/sync/streaks";
import { computeAllVarianceScores } from "../lib/variance";
import { syncFatigueData } from "../lib/sync/fatigue";
import { syncInjuries } from "../lib/sync/injuries";
import { syncProjections } from "../lib/projections/sync";
import { syncNflAdvancedMetrics } from "../lib/sync/nfl-advanced";
import { syncNhlPlayerContext } from "../lib/sync/nhl-player-context";
import { syncGameSchedule } from "../lib/sync/games";
import { syncGameOdds } from "../lib/sync/game-odds";
import { syncWeather } from "../lib/sync/weather";
import { computeMatchupHistory } from "../lib/sync/matchup-history";

const router = Router();

// ─── In-flight guards ─────────────────────────────────────────────────────────
// Prevent duplicate concurrent runs of expensive long-running jobs.
// Pattern: module-level nullable promise; caller joins existing run or starts new.
let historicalStatsInFlight: Promise<void> | null = null;
let projectionsInFlight: Promise<void> | null = null;
let calibrationInFlight: Promise<void> | null = null;

/**
 * Mark any data_pull_logs / sync_runs rows that are stuck in "running" for
 * more than 10 minutes as "error". Called at module load (server startup) so
 * a crash or SIGKILL never leaves permanent spinning indicators in the UI.
 */
async function cleanupStaleRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  try {
    const [logs, runs] = await Promise.all([
      db.update(dataPullLogsTable)
        .set({ status: "error", errorMessage: "interrupted (server restarted)", finishedAt: new Date() })
        .where(and(eq(dataPullLogsTable.status, "running"), lt(dataPullLogsTable.startedAt, cutoff)))
        .returning({ id: dataPullLogsTable.id }),
      db.update(syncRunsTable)
        .set({ status: "error", errorMessage: "interrupted (server restarted)", finishedAt: new Date() })
        .where(and(eq(syncRunsTable.status, "running"), lt(syncRunsTable.startedAt, cutoff)))
        .returning({ id: syncRunsTable.id }),
    ]);
    if (logs.length > 0 || runs.length > 0) {
      logger.info({ logs: logs.length, runs: runs.length }, "cleanupStaleRuns: cleared zombie entries");
    }
  } catch (err) {
    logger.warn({ err }, "cleanupStaleRuns: failed (non-critical)");
  }
}
// Run immediately on module load so the first data-health poll after a
// server restart never shows phantom "running" jobs.
void cleanupStaleRuns();

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

/** Write DB records + broadcast SSE for an auto-chained calibration run. */
async function runAutoCalibration(reason: string): Promise<void> {
  const [log] = await db.insert(dataPullLogsTable).values({
    provider: "internal", jobName: "calibration", status: "running", startedAt: new Date(),
  }).returning();
  const [syncRun] = await db.insert(syncRunsTable).values({
    jobName: "calibration", status: "running", startedAt: new Date(),
  }).returning();
  broadcastSyncStatus("calibration", "running", reason);
  try {
    const { calibrationJob } = await import("../scripts/calibration-job");
    const r = await calibrationJob.runHistoricalCalibration(5000);
    const processed = typeof r === "number" ? r : ((r as any)?.processed ?? (r as any)?.total ?? 0);
    logger.info({ processed, reason }, "Calibration auto-chain complete");
    await db.update(dataPullLogsTable).set({ status: "success", recordsProcessed: processed, finishedAt: new Date() }).where(eq(dataPullLogsTable.id, log.id));
    await db.update(syncRunsTable).set({ status: "success", recordsProcessed: processed, finishedAt: new Date() }).where(eq(syncRunsTable.id, syncRun.id));
    broadcastSyncStatus("calibration", "success", "Calibration complete (auto)");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Auto-chain failed";
    logger.warn({ err }, "Calibration auto-chain failed (non-critical)");
    await db.update(dataPullLogsTable).set({ status: "error", errorMessage, finishedAt: new Date() }).where(eq(dataPullLogsTable.id, log.id));
    await db.update(syncRunsTable).set({ status: "error", errorMessage, finishedAt: new Date() }).where(eq(syncRunsTable.id, syncRun.id));
    broadcastSyncStatus("calibration", "error", errorMessage);
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
  // Scores are derived from game logs (backfillHistoricalStats) and prop score
  // recalculation (recalcPropScores). This endpoint triggers both.
  const { backfillHistoricalStats } = await import("../lib/sync/historical-stats");
  const result = await backfillHistoricalStats({ nba: true, mlb: true, nhl: true, nfl: true });
  await recalcPropScores();
  return result.total;
}

router.post("/sync/historical-stats", async (req, res) => {
  if (historicalStatsInFlight) {
    res.json({ status: "skipped", reason: "already running" });
    return;
  }
  const { nba = true, mlb = true, nhl = true, nfl = true } =
    (req.body ?? {}) as { nba?: boolean; mlb?: boolean; nhl?: boolean; nfl?: boolean };
  res.json({ status: "started", sports: { nba, mlb, nhl, nfl } });
  historicalStatsInFlight = (async () => {
    try {
      const { backfillHistoricalStats } = await import("../lib/sync/historical-stats");
      const result = await backfillHistoricalStats({ nba, mlb, nhl, nfl });
      logger.info(result, "Historical backfill complete");
      broadcastSyncStatus("historical-stats", "success", `${result.total} records`);
      // Auto-chain NFL advanced metrics when NFL logs were synced
      if (nfl && result.nfl > 0) {
        logger.info("Auto-triggering NFL advanced metrics after backfill");
        syncNflAdvancedMetrics()
          .then(n => broadcastSyncStatus("nfl-advanced-metrics", "success", `${n} records (auto)`))
          .catch(err => {
            logger.warn({ err }, "NFL advanced auto-chain failed (non-critical)");
            broadcastSyncStatus("nfl-advanced-metrics", "error",
              err instanceof Error ? err.message : "Auto-chain failed");
          });
      }
      // Auto-chain calibration — only when new records were written (skip if 0)
      if (result.total > 0) {
        runAutoCalibration("Auto-started after historical-stats sync").catch(() => {});
      } else {
        logger.info("Skipping calibration auto-chain — no new game log records");
      }
    } catch (e) {
      logger.error({ err: e }, "Historical backfill failed");
      broadcastSyncStatus("historical-stats", "error", e instanceof Error ? e.message : "Unknown error");
    } finally {
      historicalStatsInFlight = null;
    }
  })();
});

// MLB pitcher hand backfill — DB-only, infers pitcher_hand on existing batter
// game logs using pitcher_game_logs + pitcher_profiles.  Safe to re-run.
router.post("/sync/backfill-mlb-pitcher-hand", async (req, res) => {
  res.json({ status: "started" });
  try {
    const { backfillMlbPitcherHand } = await import("../lib/sync/historical-stats");
    const n = await backfillMlbPitcherHand();
    broadcastSyncStatus("backfill-mlb-pitcher-hand", "success", `${n} batter logs updated`);
  } catch (e) {
    req.log.error({ err: e }, "MLB pitcher hand backfill failed");
    broadcastSyncStatus("backfill-mlb-pitcher-hand", "error", e instanceof Error ? e.message : "Unknown error");
  }
});

// #167 — Derive Blks+Stls combined game-log rows without a full NBA backfill.
// Fast (one SQL join + batch upsert), so no in-flight guard needed.
router.post("/sync/derive-blks-stls", async (req, res) => {
  res.json({ status: "started" });
  try {
    const { deriveBlksStls } = await import("../lib/sync/historical-stats");
    const n = await deriveBlksStls();
    broadcastSyncStatus("derive-blks-stls", "success", `${n} Blks+Stls rows derived`);
  } catch (e) {
    req.log.error({ err: e }, "Blks+Stls derivation failed");
    broadcastSyncStatus("derive-blks-stls", "error", e instanceof Error ? e.message : "Unknown error");
  }
});

// Fix 1 — Backfill gameId on historical PP lines
router.post("/sync/backfill-game-ids", async (req, res) => {
  res.json({ status: "started" });
  try {
    const lines = await db
      .select({
        id: ppLinesTable.id,
        playerId: ppLinesTable.playerId,
        openedAt: ppLinesTable.openedAt,
      })
      .from(ppLinesTable)
      .where(and(
        eq(ppLinesTable.isActive, false),
        isNull(ppLinesTable.gameId),
      ));

    const normalizeSport = (s: string) => {
      if (s.startsWith("MLB"))  return "MLB";
      if (s.startsWith("NBA"))  return "NBA";
      if (s.startsWith("NHL"))  return "NHL";
      if (s.startsWith("NFL"))  return "NFL";
      if (s.startsWith("WNBA")) return "WNBA";
      return s;
    };

    let updated = 0;
    for (const line of lines) {
      try {
        const [player] = await db
          .select({ teamId: playersTable.teamId, sport: playersTable.sport })
          .from(playersTable)
          .where(eq(playersTable.id, line.playerId))
          .limit(1);

        if (!player?.teamId) continue;

        const sportKey = normalizeSport(player.sport ?? "");

        const dayStart = new Date(line.openedAt!);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(line.openedAt!);
        dayEnd.setHours(23, 59, 59, 999);

        const [game] = await db
          .select({ id: gamesTable.id })
          .from(gamesTable)
          .where(and(
            eq(gamesTable.sport, sportKey),
            gte(gamesTable.startTime, dayStart),
            lte(gamesTable.startTime, dayEnd),
            or(
              eq(gamesTable.homeTeamId, player.teamId),
              eq(gamesTable.awayTeamId, player.teamId),
            ),
          ))
          .limit(1);

        if (!game) continue;

        await db.update(ppLinesTable)
          .set({ gameId: game.id })
          .where(eq(ppLinesTable.id, line.id));
        updated++;
      } catch {
        // skip individual line errors
      }
    }

    logger.info({ updated }, "Game ID backfill complete");
    broadcastSyncStatus("backfill-game-ids", "success", `${updated} lines updated`);
  } catch (e) {
    logger.error({ err: e }, "Game ID backfill failed");
    broadcastSyncStatus("backfill-game-ids", "error", e instanceof Error ? e.message : "Unknown error");
  }
});

// Fix 3 — Rebuild matchup history from game logs
router.post("/sync/matchup-history", async (req, res) => {
  await runSync("internal", "matchup-history", computeMatchupHistory, res);
});

// Fix 4 — Incremental nightly game log sync (NBA/MLB/NHL, skip NFL until season)
router.post("/sync/game-logs", async (req, res) => {
  res.json({ status: "started" });
  try {
    const { backfillHistoricalStats } = await import("../lib/sync/historical-stats");
    const result = await backfillHistoricalStats({ nba: true, mlb: true, nhl: true, nfl: true });
    logger.info(result, "Incremental game log sync done");
    broadcastSyncStatus("game-logs", "success", `${result.total} records`);
    // Auto-chain calibration — only when new records were written (skip if 0)
    if (result.total > 0) {
      runAutoCalibration("Auto-started after game-logs sync").catch(() => {});
    } else {
      logger.info("Skipping calibration auto-chain — no new game log records");
    }
  } catch (e) {
    logger.error({ err: e }, "Game log sync failed");
    broadcastSyncStatus("game-logs", "error", e instanceof Error ? e.message : "Unknown error");
  }
});

router.post("/sync/calibration", async (req, res) => {
  if (calibrationInFlight) {
    res.json({ status: "skipped", reason: "already running" });
    return;
  }
  const limit = Number((req.body as { limit?: number } | undefined)?.limit ?? 5000);
  res.json({ status: "started", limit });
  calibrationInFlight = (async () => {
    try {
      const { calibrationJob } = await import("../scripts/calibration-job");
      const result = await calibrationJob.runHistoricalCalibration(limit);
      logger.info(result, "Calibration complete");
      broadcastSyncStatus("calibration", "success", "Calibration complete");
    } catch (e) {
      logger.error({ err: e }, "Calibration failed");
      broadcastSyncStatus("calibration", "error", e instanceof Error ? e.message : "Unknown error");
    } finally {
      calibrationInFlight = null;
    }
  })();
});

router.post("/sync/game-schedule", async (req, res) => {
  await runSync("espn", "game-schedule", syncGameSchedule, res);
});

router.post("/sync/game-schedule-history", async (req, res) => {
  const {
    fromDate: fromStr = "2025-10-01",
    toDate:   toStr   = new Date().toISOString().slice(0, 10),
  } = (req.body ?? {}) as { fromDate?: string; toDate?: string };

  const fromDate = new Date(`${fromStr}T12:00:00Z`);
  const toDate   = new Date(`${toStr}T12:00:00Z`);

  res.json({ status: "started", fromDate: fromStr, toDate: toStr });

  try {
    const total = await syncGameSchedule({ fromDate, toDate });
    logger.info({ total, fromDate: fromStr, toDate: toStr },
      "Historical game schedule sync complete");
    broadcastSyncStatus("game-schedule-history", "success", `${total} games processed`);
  } catch (e) {
    logger.error({ err: e }, "Historical game schedule sync failed");
    broadcastSyncStatus("game-schedule-history", "error",
      e instanceof Error ? e.message : "Unknown error");
  }
});

// Browser-import: user's browser fetches PP directly (bypasses cloud IP block),
// posts the raw JSON here. Server processes it identically to a normal sync.
router.post("/sync/pp-lines-import", async (req, res) => {
  const body = req.body as { data?: unknown[]; included?: unknown[] };
  if (!Array.isArray(body?.data) || !Array.isArray(body?.included)) {
    res.status(400).json({ error: "Request body must have data[] and included[] arrays" });
    return;
  }
  // Sanity cap: the real PP feed is ~25k projections + included refs. Reject
  // absurd payloads to limit dataset-poisoning / DoS surface on this open route.
  const MAX_ITEMS = 200_000;
  if (body.data.length > MAX_ITEMS || body.included.length > MAX_ITEMS) {
    res.status(413).json({ error: "Payload too large — not a valid PrizePicks feed" });
    return;
  }

  const [log] = await db.insert(dataPullLogsTable).values({
    provider: "prizepicks",
    jobName: "pp-lines-browser-import",
    status: "running",
    startedAt: new Date(),
  }).returning();

  try {
    const recordsProcessed = await processPpData({ data: body.data, included: body.included });
    await recalcPropScores();
    await db.update(dataPullLogsTable)
      .set({ status: "success", recordsProcessed, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    broadcastSyncStatus("pp-lines", "success", `${recordsProcessed} records (browser import)`);
    req.log.info({ recordsProcessed }, "PP browser import complete");
    res.json({ status: "success", recordsProcessed });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    broadcastSyncStatus("pp-lines", "error", errorMessage);
    req.log.error({ err }, "PP browser import failed");
    res.status(500).json({ error: errorMessage });
  }
});

router.post("/sync/injuries", async (req, res) => {
  await runSync("injury-news", "sync-injuries", syncInjuriesImpl, res);
});

router.post("/sync/external-odds", async (req, res) => {
  // Manual trigger always uses force=true (5-min floor only) so the user can
  // sync right before slate lock regardless of when the cron last ran.
  // The cron path calls syncExternalOdds() without force, keeping the 170-min cooldown.
  await runSync("the-odds-api", "external-odds", () => syncExternalOdds(true), res);
});

router.post("/sync/game-odds", async (req, res) => {
  await runSync("the-odds-api", "game-odds", syncGameOdds, res);
});

router.post("/sync/weather", async (req, res) => {
  await runSync("open-meteo", "weather", syncWeather, res);
});

// Pre-lock sync — fast sequential refresh of the 4 data types that matter before
// game lock: lines → injuries → odds (cooldown bypassed) → prop score recalc.
// Safe to hit repeatedly; odds cooldown is bypassed intentionally here.
router.post("/sync/pre-lock", async (req, res) => {
  res.json({ status: "started", message: "Pre-lock sync initiated" });
  broadcastSyncStatus("pre-lock", "running");

  // PP lines omitted: server-side PP fetches always 403 (PerimeterX). Lines come
  // from the browser copy-paste import.
  const jobs: Array<{ name: string; provider: string; fn: () => Promise<number> }> = [
    { name: "sync-injuries", provider: "injury-news",  fn: syncInjuriesImpl },
    { name: "external-odds", provider: "the-odds-api", fn: () => syncExternalOdds(true) },
  ];

  for (const job of jobs) {
    const [log] = await db.insert(dataPullLogsTable).values({
      provider: job.provider,
      jobName:  job.name,
      status:   "running",
      startedAt: new Date(),
    }).returning();

    broadcastSyncStatus(job.name, "running");
    try {
      const n = await job.fn();
      await db.update(dataPullLogsTable)
        .set({ status: "success", recordsProcessed: n, finishedAt: new Date() })
        .where(eq(dataPullLogsTable.id, log.id));
      broadcastSyncStatus(job.name, "success", `${n} records`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      await db.update(dataPullLogsTable)
        .set({ status: "error", errorMessage: msg, finishedAt: new Date() })
        .where(eq(dataPullLogsTable.id, log.id));
      broadcastSyncStatus(job.name, "error", msg);
    }
  }

  broadcastSyncStatus("pre-lock", "success", "Pre-lock sync complete");
});

router.post("/sync/projections", async (req, res) => {
  if (projectionsInFlight) {
    res.json({ status: "skipped", reason: "already running" });
    return;
  }
  projectionsInFlight = runSync("nba-stats", "projections", syncProjectionsImpl, res)
    .finally(() => { projectionsInFlight = null; });
});

// Rescore props only — recalculates edge/action scores from existing projections.
// Does NOT call The Odds API so costs zero credits.
router.post("/sync/rescore-props", async (req, res) => {
  await runSync("internal", "rescore-props", async () => {
    await recalcPropScores();
    return 0;
  }, res);
});

router.post("/sync/scores", async (req, res) => {
  // Logs under "espn" (ESPN game logs), NOT "prizepicks" — PP's data-health dot
  // must reflect only the browser import, never a server-side scores pull.
  await runSync("espn", "sync-scores", syncScoresImpl, res);
});

router.post("/sync/nhl-player-context", async (req, res) => {
  await runSync("nhl-stats", "nhl-player-context", syncNhlPlayerContext, res);
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
    broadcastSyncStatus("nfl-advanced-metrics", "success", `${totalUpserted} records`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "NFL advanced metrics sync failed");
    await db.update(dataPullLogsTable)
      .set({ status: "error", errorMessage, finishedAt: new Date() })
      .where(eq(dataPullLogsTable.id, log.id));
    broadcastSyncStatus("nfl-advanced-metrics", "error", errorMessage);
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

// Force sync all — triggers the server-fetchable providers sequentially.
// PP lines are NOT included (browser import only — see note below).
router.post("/sync/all", async (req, res) => {
  res.json({ status: "started", message: "All syncs initiated" });
  broadcastSyncStatus("all", "running");

  // PP lines omitted: server-side PP fetches always 403 (PerimeterX). Lines come
  // from the browser copy-paste import.
  const jobs: Array<{ name: string; provider: string; fn: () => Promise<number> }> = [
    { name: "injuries",    provider: "injury-news",   fn: syncInjuriesImpl },
    { name: "external-odds", provider: "the-odds-api", fn: syncExternalOdds },
    { name: "game-odds",   provider: "the-odds-api",  fn: syncGameOdds },
    { name: "weather",     provider: "open-meteo",    fn: syncWeather },
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

// Lightweight data-readiness check — used by the UI to show bootstrap warnings.
router.get("/data-readiness", async (_req, res) => {
  try {
    const [logStats] = await db.select({
      cnt:     sql<number>`count(*)`,
      players: sql<number>`count(distinct ${playerGameLogsTable.playerId})`,
    }).from(playerGameLogsTable);
    const [calStats] = await db.select({
      cnt: sql<number>`count(*)`,
    }).from(probabilityCalibrationTable);
    const gameLogCount       = Number(logStats?.cnt ?? 0);
    const playersWithLogs    = Number(logStats?.players ?? 0);
    const calibrationBuckets = Number(calStats?.cnt ?? 0);
    res.json({
      gameLogCount,
      playersWithLogs,
      calibrationBuckets,
      isDataReady:        playersWithLogs >= 100,
      isCalibrationReady: calibrationBuckets >= 50,
    });
  } catch (err) {
    logger.error({ err }, "data-readiness check failed");
    res.status(500).json({ gameLogCount: 0, playersWithLogs: 0, calibrationBuckets: 0, isDataReady: false, isCalibrationReady: false });
  }
});

// POST /sync/auto-grade-picks — match pending entry picks against player_game_logs
// and auto-set result to hit / miss / dnp for any past-dated pick that has a
// game-log record (or where other picks from the same date do, signalling DNP).
// Fuzzy stat-type alias matching is handled in auto-grade.ts (#94).
router.post("/sync/auto-grade-picks", async (req, res) => {
  await runSync("internal", "auto-grade-picks", gradePicksJob, res);
});

// GET /sync/auto-grade-stats — pending pick counts for the Settings health panel (#93)
router.get("/sync/auto-grade-stats", async (req, res) => {
  try {
    const stats = await getAutoGradeStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "auto-grade-stats failed");
    res.status(500).json({ error: "Failed to load auto-grade stats" });
  }
});

export default router;
