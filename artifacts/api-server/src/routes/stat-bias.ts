import { Router } from "express";
import { db } from "@workspace/db";
import { entryPicksTable, entriesTable, playersTable } from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

const router = Router();

export interface StatBiasBucket {
  sport: string | null;
  statType: string;
  tier: string;
  hitCount: number;
  sampleSize: number;
  hitRate: number | null;
  avgModelPOver: number | null;
  delta: number | null;
  hasEnoughData: boolean;
}

const MIN_SAMPLE = 10;

router.get("/dashboard/stat-bias", async (req, res) => {
  try {
    const rows = await db
      .select({
        sport: playersTable.sport,
        statType: entryPicksTable.statType,
        tier: entryPicksTable.lineType,
        hitCount: sql<number>`count(*) filter (where ${entryPicksTable.result} = 'hit')`,
        sampleSize: sql<number>`count(*)`,
        avgModelPOver: sql<number | null>`avg(${entryPicksTable.yourProjection}::float)`,
      })
      .from(entryPicksTable)
      .innerJoin(entriesTable, eq(entryPicksTable.entryId, entriesTable.id))
      .leftJoin(playersTable, eq(entryPicksTable.playerId, playersTable.id))
      .where(inArray(entryPicksTable.result, ["hit", "miss"]))
      .groupBy(playersTable.sport, entryPicksTable.statType, entryPicksTable.lineType);

    const buckets: StatBiasBucket[] = rows.map(r => {
      const sampleSize = Number(r.sampleSize);
      const hitCount = Number(r.hitCount);
      const hasEnoughData = sampleSize >= MIN_SAMPLE;
      const hitRate = hasEnoughData ? hitCount / sampleSize : null;
      const avgModelPOver = r.avgModelPOver != null ? Number(r.avgModelPOver) : null;
      const avgFraction = avgModelPOver != null ? avgModelPOver / 100 : null;
      const delta = hitRate != null && avgFraction != null
        ? Math.round((hitRate - avgFraction) * 1000) / 10
        : null;
      return {
        sport: r.sport ?? null,
        statType: r.statType,
        tier: r.tier,
        hitCount,
        sampleSize,
        hitRate: hitRate != null ? Math.round(hitRate * 1000) / 1000 : null,
        avgModelPOver: avgModelPOver != null ? Math.round(avgModelPOver * 10) / 10 : null,
        delta,
        hasEnoughData,
      };
    });

    buckets.sort((a, b) => {
      const sportCmp = (a.sport ?? "").localeCompare(b.sport ?? "");
      if (sportCmp !== 0) return sportCmp;
      const stCmp = a.statType.localeCompare(b.statType);
      if (stCmp !== 0) return stCmp;
      return a.tier.localeCompare(b.tier);
    });

    res.json({ buckets });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
