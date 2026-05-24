import { Router } from "express";
import { db } from "@workspace/db";
import {
  fatigueDataTable, playersTable, ppLinesTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/fatigue/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const { sport } = req.query as Record<string, string>;

    const rows = await db
      .select({
        playerId:           fatigueDataTable.playerId,
        playerName:         playersTable.fullName,
        sport:              playersTable.sport,
        fatigueScore:       fatigueDataTable.fatigueScore,
        fatigueLabel:       fatigueDataTable.fatigueLabel,
        daysRest:           fatigueDataTable.daysRest,
        isBackToBack:       fatigueDataTable.isBackToBack,
        isThreeInFour:      fatigueDataTable.isThreeInFour,
        gamesLast7Days:     fatigueDataTable.gamesLast7Days,
        prevGameMinutes:    fatigueDataTable.prevGameMinutes,
        avgMinutesL5:       fatigueDataTable.avgMinutesL5,
        travelMiles:        fatigueDataTable.travelMiles,
        timezoneShiftHours: fatigueDataTable.timezoneShiftHours,
        prevGameHomeAway:   fatigueDataTable.prevGameHomeAway,
        warnings:           fatigueDataTable.warnings,
        computedAt:         fatigueDataTable.computedAt,
      })
      .from(fatigueDataTable)
      .innerJoin(playersTable, eq(fatigueDataTable.playerId, playersTable.id))
      .where(
        and(
          eq(fatigueDataTable.computedForDate, today),
          sport ? eq(playersTable.sport, sport.toUpperCase()) : undefined,
        )
      )
      .orderBy(desc(fatigueDataTable.fatigueScore));

    const activePlayerIds = new Set(
      (await db
        .select({ pid: ppLinesTable.playerId })
        .from(ppLinesTable)
        .where(eq(ppLinesTable.isActive, true))
      ).map(r => r.pid)
    );

    const filtered = rows.filter(r => activePlayerIds.has(r.playerId));

    res.json({
      date: today,
      players: filtered,
      computedAt: filtered[0]?.computedAt ?? null,
      summary: {
        total:        filtered.length,
        backToBack:   filtered.filter(r => r.isBackToBack).length,
        threeInFour:  filtered.filter(r => r.isThreeInFour).length,
        heavyFatigue: filtered.filter(r => (r.fatigueScore ?? 0) >= 60).length,
        wellRested:   filtered.filter(r => (r.daysRest ?? 99) >= 4).length,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /fatigue/today failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/fatigue/player/:playerId", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(fatigueDataTable)
      .where(eq(fatigueDataTable.playerId, Number(req.params.playerId)))
      .orderBy(desc(fatigueDataTable.computedForDate))
      .limit(30);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /fatigue/player failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
