import { Router } from "express";
import { db } from "@workspace/db";
import { nflAdvancedMetricsTable } from "@workspace/db/schema";
import { sql, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/nfl-advanced/slate", async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (player_name)
        player_name,
        team,
        position,
        season,
        week,
        snap_count,
        snap_pct,
        target_share,
        air_yards,
        air_yards_share,
        wopr,
        racr,
        targets
      FROM nfl_advanced_metrics
      WHERE snap_pct IS NOT NULL OR target_share IS NOT NULL OR wopr IS NOT NULL
      ORDER BY player_name, season DESC, week DESC NULLS LAST
    `);

    const mapped = rows.rows.map((r: Record<string, unknown>) => ({
      playerName:   r["player_name"] as string,
      team:         r["team"] as string,
      position:     r["position"] as string | null,
      season:       r["season"] as number,
      week:         r["week"] as number | null,
      snapCount:    r["snap_count"] != null ? Number(r["snap_count"]) : null,
      snapPct:      r["snap_pct"]    != null ? Number(r["snap_pct"]) : null,
      targetShare:  r["target_share"] != null ? Number(r["target_share"]) : null,
      airYards:     r["air_yards"]   != null ? Number(r["air_yards"]) : null,
      airYardsShare: r["air_yards_share"] != null ? Number(r["air_yards_share"]) : null,
      wopr:         r["wopr"]        != null ? Number(r["wopr"]) : null,
      racr:         r["racr"]        != null ? Number(r["racr"]) : null,
      targets:      r["targets"]     != null ? Number(r["targets"]) : null,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error(err, "NFL advanced slate fetch failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
