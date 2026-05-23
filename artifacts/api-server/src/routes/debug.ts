import { Router } from "express";
import { db } from "@workspace/db";
import { probabilityCalibrationTable } from "@workspace/db/schema";
import { eq, and, ilike } from "drizzle-orm";

const router = Router();

const DEFAULT_HIT_RATES: Record<string, Record<string, number>> = {
  goblin: { more: 0.65, less: 0.35 },
  standard: { more: 0.52, less: 0.52 },
  demon: { more: 0.35, less: 0.65 },
};

router.get("/debug/calibration", async (req, res): Promise<void> => {
  try {
    const { sport, statType } = req.query as Record<string, string>;

    const conditions = [];
    if (sport)    conditions.push(ilike(probabilityCalibrationTable.sport, sport));
    if (statType) conditions.push(ilike(probabilityCalibrationTable.statType, statType));

    const rows = conditions.length
      ? await db.select().from(probabilityCalibrationTable).where(and(...conditions))
      : await db.select().from(probabilityCalibrationTable);

    const enriched = rows.map(r => ({
      ...r,
      hitRate:    r.hitRate    ? Number(r.hitRate)    : null,
      sampleSize: r.sampleSize ?? 0,
      hitCount:   r.hitCount   ?? 0,
      source: (r.sampleSize ?? 0) > 0 ? "Your Data" : "Default Estimate",
      defaultHitRate: DEFAULT_HIT_RATES[r.lineType]?.[r.direction] ?? null,
    }));

    const lineTypes = ["goblin", "standard", "demon"] as const;
    const directions = ["more", "less"] as const;
    const edgeBuckets = ["low", "mid", "high"] as const;

    const seen = new Set(rows.map(r => `${r.sport}|${r.statType}|${r.lineType}|${r.edgeBucket}|${r.direction}`));
    const defaults: typeof enriched = [];

    if (sport && statType) {
      for (const lt of lineTypes) {
        for (const dir of directions) {
          for (const bucket of edgeBuckets) {
            const key = `${sport}|${statType}|${lt}|${bucket}|${dir}`;
            if (!seen.has(key)) {
              defaults.push({
                id: -1,
                sport,
                statType,
                lineType: lt,
                edgeBucket: bucket,
                direction: dir,
                sampleSize: 0,
                hitCount: 0,
                hitRate: null,
                confidenceInterval: null,
                lastUpdated: null,
                source: "Default Estimate",
                defaultHitRate: DEFAULT_HIT_RATES[lt]?.[dir] ?? null,
              } as any);
            }
          }
        }
      }
    }

    res.json(
      [...enriched, ...defaults].sort((a, b) =>
        `${a.lineType}${a.direction}${a.edgeBucket}`.localeCompare(`${b.lineType}${b.direction}${b.edgeBucket}`)
      )
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
