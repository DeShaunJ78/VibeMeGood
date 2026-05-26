import { Router } from "express";
import { db } from "@workspace/db";
import {
  platformLinesTable, ppLinesTable, playersTable,
  dataPullLogsTable, syncRunsTable,
} from "@workspace/db/schema";
import { eq, count, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { syncPlatformLines } from "../lib/sync/platform-lines";
import { broadcastSyncStatus } from "../lib/sse";

const router = Router();

// GET /platform-lines/by-prop?playerName=&statType=&ppLineValue=
// Returns all platform lines for one player+stat and highlights the best
router.get("/platform-lines/by-prop", async (req, res) => {
  const { playerName, statType, ppLineValue } = req.query;
  if (!playerName || !statType || ppLineValue === undefined) {
    return res.status(400).json({ error: "playerName, statType, ppLineValue required" });
  }

  const ppVal = Number(ppLineValue);

  const rows = await db
    .select()
    .from(platformLinesTable)
    .where(
      sql`LOWER(${platformLinesTable.playerName}) = LOWER(${String(playerName)})
          AND LOWER(${platformLinesTable.statType}) = LOWER(${String(statType)})`,
    );

  const allLines: Array<{ platform: string; lineValue: number }> = [
    { platform: "prizepicks", lineValue: ppVal },
    ...rows.map(r => ({ platform: r.platform, lineValue: Number(r.lineValue) })),
  ];

  // Lower line = easier for "over" = better for the bettor
  const best = allLines.reduce((b, l) => l.lineValue < b.lineValue ? l : b, allLines[0]);

  return res.json({
    playerName:     String(playerName),
    statType:       String(statType),
    ppLineValue:    ppVal,
    lines:          allLines,
    bestPlatform:   best.platform,
    bestLineValue:  best.lineValue,
    hasBetterLine:  best.lineValue < ppVal,
  });
});

// GET /platform-lines/better-lines
// Returns all PP lines where another platform has a lower (easier) line value.
// Used by Slate Board to show badges. Auto-triggers a background sync on first use.
router.get("/platform-lines/better-lines", async (req, res) => {
  // Auto-sync if table is empty on first use
  const [{ n }] = await db.select({ n: count() }).from(platformLinesTable);
  if (Number(n) === 0) {
    req.log.info("platform_lines empty — triggering background sync");
    syncPlatformLines().catch(err => req.log.error({ err }, "Auto platform-lines sync failed"));
    return res.json([]);
  }

  // Fetch all active PP lines with player names
  const ppLines = await db
    .select({
      ppLineId:    ppLinesTable.id,
      playerName:  playersTable.fullName,
      statType:    ppLinesTable.statType,
      ppLineValue: ppLinesTable.lineValue,
    })
    .from(ppLinesTable)
    .innerJoin(playersTable, eq(ppLinesTable.playerId, playersTable.id))
    .where(eq(ppLinesTable.isActive, true));

  // Load all external platform lines into a lookup map
  const extRows = await db.select().from(platformLinesTable);
  const extMap = new Map<string, { platform: string; lineValue: number }>();
  for (const r of extRows) {
    const key = `${r.playerName.toLowerCase()}:${r.statType.toLowerCase()}:${r.platform}`;
    const cur = extMap.get(key);
    if (!cur || Number(r.lineValue) < cur.lineValue) {
      extMap.set(key, { platform: r.platform, lineValue: Number(r.lineValue) });
    }
  }

  const PLATFORMS = ["underdog", "pick6", "betr"];
  const results: Array<{
    ppLineId: number;
    playerName: string;
    statType: string;
    ppLineValue: number;
    bestPlatform: string;
    bestLineValue: number;
  }> = [];

  for (const pp of ppLines) {
    const ppVal = Number(pp.ppLineValue);
    let best: { platform: string; lineValue: number } | null = null;
    for (const plat of PLATFORMS) {
      const key = `${pp.playerName.toLowerCase()}:${pp.statType.toLowerCase()}:${plat}`;
      const ext = extMap.get(key);
      if (ext && ext.lineValue < ppVal) {
        if (!best || ext.lineValue < best.lineValue) best = ext;
      }
    }
    if (best) {
      results.push({
        ppLineId:      pp.ppLineId,
        playerName:    pp.playerName,
        statType:      pp.statType,
        ppLineValue:   ppVal,
        bestPlatform:  best.platform,
        bestLineValue: best.lineValue,
      });
    }
  }

  return res.json(results);
});

// POST /platform-lines/sync — manual trigger via Settings page or curl
router.post("/platform-lines/sync", async (req, res) => {
  const [log] = await db.insert(dataPullLogsTable).values({
    provider: "underdog",
    jobName: "platform-lines",
    status: "running",
    startedAt: new Date(),
  }).returning();

  const [syncRun] = await db.insert(syncRunsTable).values({
    jobName: "platform-lines",
    status: "running",
    startedAt: new Date(),
  }).returning();

  res.json({ status: "started", logId: log.id });
  broadcastSyncStatus("platform-lines", "running");

  syncPlatformLines()
    .then(async ({ underdog, skipped }) => {
      const msg = `${underdog} lines from Underdog. Skipped: ${skipped.join("; ")}`;
      logger.info({ underdog, skipped }, "Platform lines sync complete");
      await db.update(dataPullLogsTable)
        .set({ status: "success", recordsProcessed: underdog, finishedAt: new Date() })
        .where(eq(dataPullLogsTable.id, log.id));
      await db.update(syncRunsTable)
        .set({ status: "success", recordsProcessed: underdog, finishedAt: new Date() })
        .where(eq(syncRunsTable.id, syncRun.id));
      broadcastSyncStatus("platform-lines", "success", msg);
    })
    .catch(async (err) => {
      const errorMessage = err instanceof Error ? err.message : "Unknown";
      await db.update(dataPullLogsTable)
        .set({ status: "error", errorMessage, finishedAt: new Date() })
        .where(eq(dataPullLogsTable.id, log.id));
      await db.update(syncRunsTable)
        .set({ status: "error", errorMessage, finishedAt: new Date() })
        .where(eq(syncRunsTable.id, syncRun.id));
      broadcastSyncStatus("platform-lines", "error", errorMessage);
    });
});

export default router;
