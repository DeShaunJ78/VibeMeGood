import { Router } from "express";
import { db } from "@workspace/db";
import { dataPullLogsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

const router = Router();

// Keys must match the `provider` column written to data_pull_logs (not the jobName).
// Check cron.ts / sync.ts for the provider string used in each logPull/runSync call.
const PROVIDERS = ["prizepicks", "the-odds-api", "nba-stats", "injury-news"];

router.get("/dashboard/data-health", async (req, res) => {
  try {
    // Get latest log per provider
    const allLogs = await db.select().from(dataPullLogsTable).orderBy(desc(dataPullLogsTable.startedAt)).limit(200);

    const providerLatest: Record<string, typeof allLogs[0]> = {};
    for (const log of allLogs) {
      if (!providerLatest[log.provider]) {
        providerLatest[log.provider] = log;
      }
    }

    const providers = PROVIDERS.map(name => {
      const latest = providerLatest[name];
      const providerLogs = allLogs.filter(l => l.provider === name);
      const recentSuccess = providerLogs.filter(l => l.status === "success").length;
      const recentTotal = providerLogs.slice(0, 10).length;
      return {
        name,
        status: latest?.status ?? "never_run",
        lastRunAt: latest?.startedAt?.toISOString() ?? null,
        lastSuccessAt: providerLogs.find(l => l.status === "success")?.startedAt?.toISOString() ?? null,
        lastError: providerLogs.find(l => l.status === "error")?.errorMessage ?? null,
        recentSuccessRate: recentTotal > 0 ? recentSuccess / recentTotal : null,
      };
    });

    const mode = process.env.DATA_MODE ?? "live";

    res.json({
      providers,
      lastPullLogs: allLogs.slice(0, 20),
      mode,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
