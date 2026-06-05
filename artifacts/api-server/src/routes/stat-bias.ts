import { Router } from "express";
import { db } from "@workspace/db";
import { entryPicksTable, entriesTable, playersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const router = Router();

export interface StatBiasBucket {
  sport: string | null;
  statType: string;
  tier: string;
  totalCount: number;
  gradedCount: number;
  pendingCount: number;
  hitCount: number;
  hitRate: number | null;
  avgModelPOver: number | null;
  delta: number | null;
  hasEnoughData: boolean;
}

const MIN_GRADED = 10;

router.get("/dashboard/stat-bias", async (req, res) => {
  try {
    // Include ALL picks (pending + graded + dnp) so buckets appear immediately
    // as entries are logged — users can monitor progress toward the 10-graded threshold.
    const rows = await db
      .select({
        sport: playersTable.sport,
        statType: entryPicksTable.statType,
        tier: entryPicksTable.lineType,
        totalCount: sql<number>`count(*)`,
        gradedCount: sql<number>`count(*) filter (where ${entryPicksTable.result} in ('hit', 'miss'))`,
        pendingCount: sql<number>`count(*) filter (where ${entryPicksTable.result} = 'pending')`,
        hitCount: sql<number>`count(*) filter (where ${entryPicksTable.result} = 'hit')`,
        // Model pOver proxy: fraction of graded picks where the model projected
        // above the PrizePicks line (projectionGap > 0). Returned on 0–100 scale.
        modelOverCount: sql<number>`count(*) filter (where ${entryPicksTable.result} in ('hit','miss') and ${entryPicksTable.projectionGap} is not null and ${entryPicksTable.projectionGap}::float > 0)`,
        modelNonNullCount: sql<number>`count(*) filter (where ${entryPicksTable.result} in ('hit','miss') and ${entryPicksTable.projectionGap} is not null)`,
      })
      .from(entryPicksTable)
      .innerJoin(entriesTable, eq(entryPicksTable.entryId, entriesTable.id))
      .leftJoin(playersTable, eq(entryPicksTable.playerId, playersTable.id))
      // No WHERE on result — include pending so buckets grow visibly before grading
      .groupBy(playersTable.sport, entryPicksTable.statType, entryPicksTable.lineType);

    const buckets: StatBiasBucket[] = rows.map(r => {
      const gradedCount = Number(r.gradedCount);
      const totalCount = Number(r.totalCount);
      const pendingCount = Number(r.pendingCount);
      const hitCount = Number(r.hitCount);
      const hasEnoughData = gradedCount >= MIN_GRADED;

      const hitRate = gradedCount > 0 ? hitCount / gradedCount : null;

      const modelNonNull = Number(r.modelNonNullCount);
      const modelOver = Number(r.modelOverCount);
      const avgModelPOver = modelNonNull > 0
        ? Math.round((modelOver / modelNonNull) * 1000) / 10
        : null;

      const delta = hitRate != null && avgModelPOver != null
        ? Math.round((hitRate * 100 - avgModelPOver) * 10) / 10
        : null;

      return {
        sport: r.sport ?? null,
        statType: r.statType,
        tier: r.tier,
        totalCount,
        gradedCount,
        pendingCount,
        hitCount,
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
