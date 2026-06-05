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
        // Model pOver proxy: fraction of picks where the model projected above the line
        // (projectionGap > 0 means model's stat value exceeds the PrizePicks line).
        // Returned as 0–100 to stay consistent with pOver conventions.
        modelOverCount: sql<number>`count(*) filter (where ${entryPicksTable.projectionGap} is not null and ${entryPicksTable.projectionGap}::float > 0)`,
        modelNonNullCount: sql<number>`count(*) filter (where ${entryPicksTable.projectionGap} is not null)`,
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
      const hitRate = sampleSize > 0 ? hitCount / sampleSize : null;

      // avgModelPOver = % of graded picks where model projected above the line.
      // Null when no projection data exists for the bucket.
      const modelNonNull = Number(r.modelNonNullCount);
      const modelOver = Number(r.modelOverCount);
      const avgModelPOver = modelNonNull > 0
        ? Math.round((modelOver / modelNonNull) * 1000) / 10   // 0–100 scale
        : null;

      const delta = hitRate != null && avgModelPOver != null
        ? Math.round((hitRate * 100 - avgModelPOver) * 10) / 10
        : null;

      return {
        sport: r.sport ?? null,
        statType: r.statType,
        tier: r.tier,
        hitCount,
        sampleSize,
        hitRate: hitRate != null ? Math.round(hitRate * 1000) / 1000 : null,
        avgModelPOver,
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
