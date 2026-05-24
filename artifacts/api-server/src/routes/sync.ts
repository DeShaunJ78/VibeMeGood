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
  const SPORT_URLS: Record<string, string> = {
    NBA:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
    MLB:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries",
    NHL:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries",
    NFL:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries",
    WNBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/injuries",
  };

  let processed = 0;

  for (const [sport, url] of Object.entries(SPORT_URLS)) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn({ sport, status: res.status }, "ESPN injury fetch non-OK");
        continue;
      }
      const data = await res.json() as { injuries?: any[] };

      for (const item of (data.injuries ?? [])) {
        try {
          const athleteName = (item.athlete?.displayName ?? item.athlete?.fullName) as string | undefined;
          if (!athleteName) continue;

          const rawStatus = (item.status ?? "") as string;
          const normalizedStatus = rawStatus.toLowerCase().includes("out") ? "out"
            : rawStatus.toLowerCase().includes("doubt") ? "doubtful"
            : rawStatus.toLowerCase().includes("question") ? "questionable"
            : rawStatus.toLowerCase().includes("probable") ? "probable"
            : rawStatus.toLowerCase().includes("day") ? "gtd"
            : "active";

          const note = ((item.detail ?? item.longComment ?? item.shortComment ?? "") as string).slice(0, 500);
          const reportedAt = item.date ? new Date(item.date as string) : new Date();

          const [player] = await db.select({ id: playersTable.id })
            .from(playersTable)
            .where(and(eq(playersTable.fullName, athleteName), eq(playersTable.sport, sport)))
            .limit(1);
          if (!player) continue;

          const [existing] = await db.select({ id: injuriesTable.id })
            .from(injuriesTable)
            .where(eq(injuriesTable.playerId, player.id))
            .limit(1);

          if (existing) {
            await db.update(injuriesTable)
              .set({ status: normalizedStatus, note, source: "espn", reportedAt })
              .where(eq(injuriesTable.id, existing.id));
          } else {
            await db.insert(injuriesTable).values({
              playerId: player.id,
              sport,
              status: normalizedStatus,
              note,
              source: "espn",
              reportedAt,
            });
          }

          if (normalizedStatus === "out" || normalizedStatus === "questionable" || normalizedStatus === "gtd") {
            broadcast("injury_alert", {
              playerName: athleteName,
              status: normalizedStatus.toUpperCase(),
              message: `${athleteName} is listed ${normalizedStatus.toUpperCase()} — check your active entries`,
              severity: normalizedStatus === "out" ? "critical" : "warning",
            });
            await db.insert(alertsTable).values({
              type: "injury_update",
              severity: normalizedStatus === "out" ? "warning" : "info",
              title: `${athleteName} — ${normalizedStatus.toUpperCase()}`,
              message: `${athleteName} is listed ${normalizedStatus.toUpperCase()} per ESPN.`,
            });
          }

          processed++;
        } catch (e) {
          logger.warn({ err: e }, "Error processing ESPN injury item");
        }
      }
    } catch (e) {
      logger.error({ err: e, sport }, "ESPN injury fetch error");
    }
  }

  return processed;
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
