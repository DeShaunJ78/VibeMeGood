import app from "./app";
import { db } from "@workspace/db";
import { playerGameLogsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { startCronJobs } from "./lib/cron";
import { computeAllProjections } from "./lib/projection/compute";
import { recalcPropScores } from "./lib/sync/external-odds";
import { computeStreaks } from "./lib/sync/streaks";
import { syncFatigueData } from "./lib/sync/fatigue";
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
  // Skip when there are no game logs — otherwise every line gets insufficient_data
  // and prop_scores are overwritten with NO-PLAY (breaks seed/dev DBs).
  setTimeout(async () => {
    try {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(playerGameLogsTable);
      if (Number(count) === 0) {
        logger.warn("Skipping startup projection warmup — no player_game_logs rows");
        return;
      }
      const n = await computeAllProjections();
      await recalcPropScores();
      await computeStreaks();
      await syncFatigueData();
      await computeAllVarianceScores();
      logger.info({ computed: n }, "Startup projection run complete");
    } catch (e) {
      logger.error(e, "Startup projection run failed");
    }
  }, 2000);
});
