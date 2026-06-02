import { Router } from "express";
import { db } from "@workspace/db";
import { backtestResultsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { runBacktest } from "../lib/projection/backtest-engine.js";

const router = Router();

router.get("/audit/latest", async (req, res) => {
  const rows = await db
    .select()
    .from(backtestResultsTable)
    .orderBy(desc(backtestResultsTable.runAt))
    .limit(1);

  if (!rows.length) {
    res.status(404).json({ error: "No backtest results yet. POST /api/audit/run to generate." });
    return;
  }

  const row = rows[0];
  res.json({
    id:          row.id,
    runAt:       row.runAt,
    series:      row.series,
    predictions: row.predictions,
    ...(row.result as object),
  });
});

router.get("/audit/runs", async (req, res) => {
  const rows = await db
    .select({
      id:          backtestResultsTable.id,
      runAt:       backtestResultsTable.runAt,
      series:      backtestResultsTable.series,
      predictions: backtestResultsTable.predictions,
    })
    .from(backtestResultsTable)
    .orderBy(desc(backtestResultsTable.runAt))
    .limit(20);

  res.json(rows);
});

router.post("/audit/run", async (req, res) => {
  req.log.info("Backtest run requested");
  const result = await runBacktest();

  const [row] = await db
    .insert(backtestResultsTable)
    .values({
      series:      result.series,
      predictions: result.predictions,
      result:      result as unknown as Record<string, unknown>,
    })
    .returning();

  req.log.info({ series: result.series, predictions: result.predictions }, "Backtest complete");
  res.json({ id: row.id, ...result });
});

export default router;
