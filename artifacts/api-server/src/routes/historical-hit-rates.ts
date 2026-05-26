import { Router } from "express";
import { db } from "@workspace/db";
import { playerGameLogsTable, playersTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

interface HitRateWindow {
  hits: number;
  total: number;
  rate: number;
}

function computeWindow(values: number[], line: number): HitRateWindow {
  const total = values.length;
  const hits = values.filter(v => v > line).length;
  const rate = total > 0 ? Math.round((hits / total) * 1000) / 10 : 0;
  return { hits, total, rate };
}

router.get("/historical-hit-rates", async (req, res) => {
  const { playerId, statType, line, opponentTeamId } = req.query;

  const lineNum = Number(line);
  if (!playerId || !statType || isNaN(lineNum)) {
    return res.status(400).json({ error: "playerId, statType, and line are required" });
  }

  const pidNum = Number(playerId);

  const [player] = await db
    .select({ fullName: playersTable.fullName })
    .from(playersTable)
    .where(eq(playersTable.id, pidNum))
    .limit(1);

  const logs = await db
    .select({
      value:          playerGameLogsTable.value,
      gameDate:       playerGameLogsTable.gameDate,
      opponentTeamId: playerGameLogsTable.opponentTeamId,
    })
    .from(playerGameLogsTable)
    .where(and(
      eq(playerGameLogsTable.playerId, pidNum),
      eq(playerGameLogsTable.statType, statType as string),
    ))
    .orderBy(desc(playerGameLogsTable.gameDate));

  const allValues = logs.map(l => Number(l.value));

  const season = computeWindow(allValues,            lineNum);
  const last30  = computeWindow(allValues.slice(0, 30), lineNum);
  const last10  = computeWindow(allValues.slice(0, 10), lineNum);

  let vsThisOpponent: HitRateWindow = { hits: 0, total: 0, rate: 0 };
  if (opponentTeamId) {
    const oppNum = Number(opponentTeamId);
    const oppValues = logs
      .filter(l => l.opponentTeamId === oppNum)
      .map(l => Number(l.value));
    vsThisOpponent = computeWindow(oppValues, lineNum);
  }

  return res.json({
    playerName:      player?.fullName ?? "Unknown",
    statType:        statType as string,
    line:            lineNum,
    last10,
    last30,
    season,
    vsThisOpponent,
  });
});

export default router;
