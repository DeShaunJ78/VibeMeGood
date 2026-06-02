import { Router } from "express";
import { db } from "@workspace/db";
import { dataPullLogsTable, ppLinesTable } from "@workspace/db/schema";
import { desc, eq, max, and, isNotNull } from "drizzle-orm";

const router = Router();

// All providers that write to data_pull_logs (provider column).
// Keep this in sync with cron.ts / sync.ts.
const PROVIDERS = [
  // PP lines require a manual browser import (server-side fetches always 403
  // from PerimeterX). Marking it non-critical prevents a permanent DEGRADED
  // alarm just because no import has been done since the last server restart.
  { id: "prizepicks",   label: "PrizePicks Lines",       critical: false },
  { id: "injury-news",  label: "Injuries (ESPN)",         critical: true },
  { id: "the-odds-api", label: "External Odds",           critical: false },
  { id: "nba-stats",    label: "Model Projections",       critical: false },
  { id: "fantasypros",  label: "FantasyPros Projections", critical: false },
  { id: "espn",         label: "Game Schedule / Logs",    critical: false },
  { id: "internal",     label: "Internal (Variance / Fatigue / Matchups)", critical: false },
  { id: "nflverse",     label: "NFL Advanced Metrics",    critical: false },
];

router.get("/dashboard/data-health", async (req, res) => {
  try {
    const allLogs = await db
      .select()
      .from(dataPullLogsTable)
      .orderBy(desc(dataPullLogsTable.startedAt))
      .limit(500);

    // Latest log per provider
    const providerLatest: Record<string, typeof allLogs[0]> = {};
    for (const log of allLogs) {
      if (!providerLatest[log.provider]) {
        providerLatest[log.provider] = log;
      }
    }

    const providers = PROVIDERS.map(({ id, label, critical }) => {
      const providerLogs = allLogs.filter(l => l.provider === id);
      const latest = providerLatest[id];
      const last10 = providerLogs.slice(0, 10);
      const successCount = last10.filter(l => l.status === "success").length;
      const lastSuccess = providerLogs.find(l => l.status === "success");
      const lastError = providerLogs.find(l => l.status === "error");
      return {
        name: id,
        label,
        critical,
        status: latest?.status ?? "never_run",
        lastRunAt: latest?.startedAt?.toISOString() ?? null,
        lastSuccessAt: lastSuccess?.startedAt?.toISOString() ?? null,
        lastError: lastError?.errorMessage ?? null,
        recentSuccessRate: last10.length > 0 ? successCount / last10.length : null,
        recordsLastSync: lastSuccess?.recordsProcessed ?? null,
      };
    });

    // Actual data freshness from pp_lines — most reliable "is the board current" signal
    const [freshnessRow] = await db
      .select({ newestSync: max(ppLinesTable.lastSyncedAt) })
      .from(ppLinesTable)
      .where(and(
        eq(ppLinesTable.isActive, true),
        isNotNull(ppLinesTable.lastSyncedAt),
      ));

    const boardFreshnessAt = freshnessRow?.newestSync?.toISOString() ?? null;
    const boardAgeHours = boardFreshnessAt
      ? Math.round((Date.now() - new Date(boardFreshnessAt).getTime()) / 36_000) / 100
      : null;

    // Overall health: degraded if any critical provider's last 3 runs all failed
    const criticalProviders = providers.filter(p => p.critical);
    const systemHealthy = criticalProviders.every(p => {
      const last3 = allLogs.filter(l => l.provider === p.name).slice(0, 3);
      return last3.some(l => l.status === "success");
    });

    const mode = process.env.DATA_MODE ?? "live";

    res.json({
      providers,
      boardFreshnessAt,
      boardAgeHours,
      systemHealthy,
      lastPullLogs: allLogs.slice(0, 30),
      mode,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
