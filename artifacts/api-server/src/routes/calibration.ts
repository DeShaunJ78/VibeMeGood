import { Router } from "express";
import { db } from "@workspace/db";
import { probabilityCalibrationTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

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

export default router;
