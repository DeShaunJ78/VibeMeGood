import { Router } from "express";
import { db } from "@workspace/db";
import { payoutConfigTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/payout-config", async (req, res) => {
  try {
    const configs = await db.select().from(payoutConfigTable);
    res.json(configs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/payout-config", async (req, res) => {
  try {
    const [config] = await db.insert(payoutConfigTable).values(req.body).returning();
    res.status(201).json(config);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/payout-config/:id", async (req, res) => {
  try {
    const [config] = await db.update(payoutConfigTable)
      .set(req.body)
      .where(eq(payoutConfigTable.id, Number(req.params.id)))
      .returning();
    if (!config) return void res.status(404).json({ error: "Config not found" });
    res.json(config);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
