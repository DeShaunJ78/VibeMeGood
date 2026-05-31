import { Router } from "express";
import { db } from "@workspace/db";
import { dataPullLogsTable, alertsTable, syncRunsTable, playersTable, injuriesTable, ppLinesTable, gamesTable } from "@workspace/db/schema";
import { eq, and, isNull, or, gte, lte } from "drizzle-orm";
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
import { syncGameSchedule } from "../lib/sync/games";
import { computeMatchupHistory } from "../lib/sync/matchup-history";

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

router.post("/sync/historical-stats", async (req, res) => {
  const { nba = true, mlb = true, nhl = true, nfl = true } =
    (req.body ?? {}) as { nba?: boolean; mlb?: boolean; nhl?: boolean; nfl?: boolean };
  res.json({ status: "started", sports: { nba, mlb, nhl, nfl } });
  try {
    const { backfillHistoricalStats } = await import("../lib/sync/historical-stats");
    const result = await backfillHistoricalStats({ nba, mlb, nhl, nfl });
    logger.info(result, "Historical backfill complete");
  } catch (e) {
    logger.error({ err: e }, "Historical backfill failed");
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
    const result = await backfillHistoricalStats({ nba: true, mlb: true, nhl: true, nfl: false });
    logger.info(result, "Incremental game log sync done");
    broadcastSyncStatus("game-logs", "success", `${result.total} records`);
  } catch (e) {
    logger.error({ err: e }, "Game log sync failed");
    broadcastSyncStatus("game-logs", "error", e instanceof Error ? e.message : "Unknown error");
  }
});

router.post("/sync/calibration", async (req, res) => {
  const limit = Number((req.body as { limit?: number } | undefined)?.limit ?? 5000);
  res.json({ status: "started", limit });
  try {
    const { calibrationJob } = await import("../scripts/calibration-job");
    const result = await calibrationJob.runHistoricalCalibration(limit);
    logger.info(result, "Calibration complete");
  } catch (e) {
    logger.error({ err: e }, "Calibration failed");
  }
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

router.post("/sync/pp-lines", async (req, res) => {
  await runSync("prizepicks", "pp-lines", syncPpLines, res);
  // Recalc prop scores after new lines arrive so edges/action tags stay current.
  // computeAllProjections is NOT called here — projections are built from nightly
  // game logs and don't change when PP rotates line values.
  await recalcPropScores();
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
