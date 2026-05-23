import { Router } from "express";
import { db } from "@workspace/db";
import { clvRecordsTable, entryPicksTable, playersTable, teamsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/clv", async (req, res): Promise<void> => {
  try {
    const records = await db
      .select({
        id:           clvRecordsTable.id,
        clv:          clvRecordsTable.clv,
        lockedLine:   clvRecordsTable.lockedLine,
        closingLine:  clvRecordsTable.closingLine,
        direction:    clvRecordsTable.direction,
        createdAt:    clvRecordsTable.createdAt,
        pickResult:   entryPicksTable.result,
        statType:     entryPicksTable.statType,
        lineType:     entryPicksTable.lineType,
        playerName:   playersTable.fullName,
        sport:        playersTable.sport,
        teamAbbr:     teamsTable.abbreviation,
      })
      .from(clvRecordsTable)
      .innerJoin(entryPicksTable, eq(clvRecordsTable.entryPickId, entryPicksTable.id))
      .innerJoin(playersTable,    eq(entryPicksTable.playerId, playersTable.id))
      .leftJoin(teamsTable,       eq(playersTable.teamId, teamsTable.id))
      .orderBy(desc(clvRecordsTable.createdAt));

    const now = Date.now();
    const MS_7D  = 7  * 24 * 60 * 60 * 1000;
    const MS_30D = 30 * 24 * 60 * 60 * 1000;
    const MS_90D = 90 * 24 * 60 * 60 * 1000;

    function avgClv(recs: typeof records, sinceMs: number) {
      const filtered = recs.filter(r => {
        if (!r.clv || !r.createdAt) return false;
        return now - new Date(r.createdAt).getTime() <= sinceMs;
      });
      if (!filtered.length) return null;
      const sum = filtered.reduce((a, r) => a + parseFloat(r.clv!.toString()), 0);
      return Math.round((sum / filtered.length) * 1000) / 1000;
    }

    const byDayMap: Record<string, number[]> = {};
    for (const r of records) {
      if (!r.clv || !r.createdAt) continue;
      const day = new Date(r.createdAt).toISOString().split("T")[0];
      if (!byDayMap[day]) byDayMap[day] = [];
      byDayMap[day].push(parseFloat(r.clv.toString()));
    }
    const clvByDay = Object.entries(byDayMap)
      .map(([date, vals]) => ({
        date,
        avgClv: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
        count: vals.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    const bySport: Record<string, { sum: number; count: number }> = {};
    for (const r of records) {
      if (!r.clv || !r.sport) continue;
      if (!bySport[r.sport]) bySport[r.sport] = { sum: 0, count: 0 };
      bySport[r.sport].sum   += parseFloat(r.clv.toString());
      bySport[r.sport].count += 1;
    }
    const clvBySport = Object.entries(bySport).map(([sport, { sum, count }]) => ({
      sport,
      avgClv: Math.round((sum / count) * 100) / 100,
      count,
    }));

    const totalClv = records.reduce((a, r) => a + (r.clv ? parseFloat(r.clv.toString()) : 0), 0);
    const positiveClv = records.filter(r => r.clv && parseFloat(r.clv.toString()) > 0).length;

    res.json({
      records: records.map(r => ({ ...r, team: r.teamAbbr ?? null })),
      summary: {
        avg7d:  avgClv(records, MS_7D),
        avg30d: avgClv(records, MS_30D),
        avg90d: avgClv(records, MS_90D),
        total:  records.length,
        positiveCount: positiveClv,
        positiveRate:  records.length > 0
          ? Math.round((positiveClv / records.length) * 1000) / 10
          : null,
        overallAvg: records.length > 0
          ? Math.round((totalClv / records.length) * 1000) / 1000
          : null,
      },
      clvByDay,
      clvBySport,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
