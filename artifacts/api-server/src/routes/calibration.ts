import { Router } from "express";
import { db } from "@workspace/db";
import { probabilityCalibrationTable } from "@workspace/db/schema";
import { desc, eq, count, max } from "drizzle-orm";

const router = Router();

router.get("/calibration", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(probabilityCalibrationTable)
      .orderBy(desc(probabilityCalibrationTable.lastUpdated));
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Bucket midpoint: edge above 50% for each bucket range
const BUCKET_MIDPOINTS: Record<string, number> = {
  "0-5":   2.5,
  "5-10":  7.5,
  "10-15": 12.5,
  "15-20": 17.5,
  "20-25": 22.5,
  "25+":   30.0,
};

const BUCKET_ORDER = ["0-5", "5-10", "10-15", "15-20", "20-25", "25+"];

router.get("/calibration/status", async (req, res) => {
  try {
    const [row] = await db
      .select({
        bucketCount: count(),
        lastUpdated: max(probabilityCalibrationTable.lastUpdated),
      })
      .from(probabilityCalibrationTable);

    const bucketCount = Number(row?.bucketCount ?? 0);
    const lastUpdated = row?.lastUpdated ?? null;
    const ageHours = lastUpdated
      ? (Date.now() - lastUpdated.getTime()) / 3600000
      : null;
    const isStale = ageHours == null || ageHours > 7 * 24;

    res.json({
      bucketCount,
      lastUpdated: lastUpdated?.toISOString() ?? null,
      ageHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
      isStale,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/calibration/diagnostics", async (req, res) => {
  try {
    const { sport, statType } = req.query as { sport?: string; statType?: string };

    const allRows = await db
      .select()
      .from(probabilityCalibrationTable)
      .where(eq(probabilityCalibrationTable.lineType, "all"));

    const sports    = [...new Set(allRows.map(r => r.sport))].sort();
    const statTypes = [...new Set(allRows.map(r => r.statType))].sort();

    let rows = allRows;
    if (sport)    rows = rows.filter(r => r.sport === sport);
    if (statType) rows = rows.filter(r => r.statType === statType);

    // Aggregate by (sport, statType, edgeBucket, direction) — one row per combination
    type Agg = { sport: string; statType: string; edgeBucket: string; direction: string; sampleSize: number; hitCount: number };
    const aggMap = new Map<string, Agg>();
    for (const r of rows) {
      const key = `${r.sport}|${r.statType}|${r.edgeBucket}|${r.direction}`;
      const a = aggMap.get(key) ?? { sport: r.sport, statType: r.statType, edgeBucket: r.edgeBucket, direction: r.direction, sampleSize: 0, hitCount: 0 };
      a.sampleSize += r.sampleSize ?? 0;
      a.hitCount   += r.hitCount   ?? 0;
      aggMap.set(key, a);
    }

    const totalSamples = [...aggMap.values()].reduce((s, a) => s + a.sampleSize, 0);

    const buckets = [...aggMap.values()]
      .map(a => {
        const midpointEdge = BUCKET_MIDPOINTS[a.edgeBucket] ?? 30;
        // predictedProb: probability assigned to the PREDICTED direction
        const predictedProb = (50 + midpointEdge) / 100;
        // actualRate: fraction of events where the predicted direction won
        const actualRate = a.sampleSize > 0 ? a.hitCount / a.sampleSize : 0;
        const calibrationError = Math.abs(predictedProb - actualRate);
        const weight = totalSamples > 0 ? a.sampleSize / totalSamples : 0;
        // Exact Brier score for this bucket (treating all predictions = bucket midpoint)
        const bucketBrier = a.sampleSize > 0
          ? (a.hitCount * Math.pow(predictedProb - 1, 2) +
             (a.sampleSize - a.hitCount) * Math.pow(predictedProb, 2)) / a.sampleSize
          : 0;
        return {
          sport:            a.sport,
          statType:         a.statType,
          edgeBucket:       a.edgeBucket,
          direction:        a.direction,
          predictedProb:    Math.round(predictedProb   * 10000) / 10000,
          actualRate:       Math.round(actualRate       * 10000) / 10000,
          sampleSize:       a.sampleSize,
          calibrationError: Math.round(calibrationError * 10000) / 10000,
          bucketBrier:      Math.round(bucketBrier       * 10000) / 10000,
          ecContrib:        Math.round(calibrationError * weight * 10000) / 10000,
          brierContrib:     Math.round(bucketBrier * weight * 10000) / 10000,
        };
      })
      .sort((a, b) => {
        const sportCmp = a.sport.localeCompare(b.sport);
        if (sportCmp !== 0) return sportCmp;
        const stCmp = a.statType.localeCompare(b.statType);
        if (stCmp !== 0) return stCmp;
        const ai = BUCKET_ORDER.indexOf(a.edgeBucket);
        const bi = BUCKET_ORDER.indexOf(b.edgeBucket);
        return ai !== bi ? ai - bi : a.direction.localeCompare(b.direction);
      });

    const ece = Math.round(buckets.reduce((s, b) => s + b.ecContrib,    0) * 10000) / 10000;
    const brierScore = Math.round(buckets.reduce((s, b) => s + b.brierContrib, 0) * 10000) / 10000;
    const avgCalibrationError = buckets.length > 0
      ? Math.round(buckets.reduce((s, b) => s + b.calibrationError, 0) / buckets.length * 10000) / 10000
      : 0;
    const maxCalibrationError = buckets.length > 0
      ? Math.round(Math.max(...buckets.map(b => b.calibrationError)) * 10000) / 10000
      : 0;

    res.json({
      buckets,
      summary: { ece, brierScore, totalSamples, avgCalibrationError, maxCalibrationError },
      filters: { sports, statTypes },
      sport:    sport    ?? null,
      statType: statType ?? null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
