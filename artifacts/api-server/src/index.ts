import app from "./app";
import { logger } from "./lib/logger";
import { startCronJobs, logPull } from "./lib/cron";
import { computeAllProjections } from "./lib/projection/compute";
import { recalcPropScores } from "./lib/sync/external-odds";
import { computeStreaks } from "./lib/sync/streaks";
import { syncFatigueData } from "./lib/sync/fatigue";
import { syncNhlPlayerContext } from "./lib/sync/nhl-player-context";
import { computeAllVarianceScores } from "./lib/variance";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCronJobs();

  // Warm up projection engine on every restart so the board is always fresh.
  // logPull writes a data_pull_logs row so system-health shows green immediately
  // after a deploy instead of showing the timestamp from the previous server instance.
  setTimeout(async () => {
    try {
      let computed = 0;
      // Refresh NHL skater context FIRST so computeAllProjections() has fresh
      // TOI / PP unit / Corsi data when it runs the NHL Saber Sim factor block.
      await logPull("internal", "nhl-player-context", async () => {
        const n = await syncNhlPlayerContext();
        return n;
      });
      await logPull("nba-stats", "projections", async () => {
        computed = await computeAllProjections();
        await recalcPropScores();
        await computeStreaks();
        return computed;
      });
      await logPull("internal", "fatigue", async () => {
        await syncFatigueData();
        return 0;
      });
      await logPull("internal", "variance", async () => {
        const n = await computeAllVarianceScores();
        return n;
      });
      logger.info({ computed }, "Startup projection run complete");
    } catch (e) {
      logger.error(e, "Startup projection run failed");
    }
  }, 2000);
});
