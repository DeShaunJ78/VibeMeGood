import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  ppLinesTable,
  playersTable,
  teamsTable,
  ourProjectionsTable,
  playerGameLogsTable,
} from "@workspace/db/schema";
import { inArray, desc } from "drizzle-orm";
import { simulateEntry, type SimLeg } from "../lib/simulation/entry-simulator";
import { computeStdDev } from "../lib/simulation/distributions";

const router = Router();

const SimLegInputSchema = z.object({
  ppLineId:  z.number().int(),
  direction: z.enum(["more", "less"]),
  modelProb: z.number().min(0).max(1),
});

const SimRequestSchema = z.object({
  legs:       z.array(SimLegInputSchema).min(1).max(6),
  runs:       z.number().int().min(100).max(25000).default(10000),
  multiplier: z.number().min(0),
  entryType:  z.string(),
});

router.post("/simulation/entry", async (req, res) => {
  const parsed = SimRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { legs: inputLegs, runs, multiplier } = parsed.data;
  const ppLineIds = inputLegs.map(l => l.ppLineId);

  // ── Fetch ppLines ──────────────────────────────────────────────────────
  const ppLines = await db
    .select()
    .from(ppLinesTable)
    .where(inArray(ppLinesTable.id, ppLineIds));

  const ppLineMap = new Map(ppLines.map(r => [r.id, r]));

  const playerIds = [...new Set(
    ppLines.map(l => l.playerId).filter((id): id is number => id != null),
  )];

  // ── Fetch players + teams in parallel ─────────────────────────────────
  const players = playerIds.length > 0
    ? await db.select().from(playersTable).where(inArray(playersTable.id, playerIds))
    : [];
  const playerMap = new Map(players.map(p => [p.id, p]));

  const teamIds = [...new Set(players.map(p => p.teamId).filter((id): id is number => id != null))];
  const teams = teamIds.length > 0
    ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = new Map(teams.map(t => [t.id, t]));

  // ── Fetch our projections ──────────────────────────────────────────────
  const projections = playerIds.length > 0
    ? await db
        .select()
        .from(ourProjectionsTable)
        .where(inArray(ourProjectionsTable.playerId, playerIds))
    : [];
  const projMap = new Map(projections.map(p => [`${p.playerId}:${p.statType}`, p]));

  // ── Fetch recent game logs ─────────────────────────────────────────────
  const gameLogs = playerIds.length > 0
    ? await db
        .select()
        .from(playerGameLogsTable)
        .where(inArray(playerGameLogsTable.playerId, playerIds))
        .orderBy(desc(playerGameLogsTable.gameDate))
        .limit(playerIds.length * 20)
    : [];

  const logMap = new Map<string, number[]>();
  for (const g of gameLogs) {
    const key = `${g.playerId}:${g.statType}`;
    const arr = logMap.get(key) ?? [];
    if (arr.length < 20) arr.push(Number(g.value));
    logMap.set(key, arr);
  }

  // ── Build enriched SimLeg[] ────────────────────────────────────────────
  const simLegs: SimLeg[] = [];

  for (const input of inputLegs) {
    const ppLine = ppLineMap.get(input.ppLineId);
    if (!ppLine) continue;

    const player    = ppLine.playerId != null ? playerMap.get(ppLine.playerId) : null;
    const team      = player?.teamId != null  ? teamMap.get(player.teamId) : null;
    const projKey   = ppLine.playerId != null ? `${ppLine.playerId}:${ppLine.statType}` : null;
    const proj      = projKey ? projMap.get(projKey) : null;
    const logs      = projKey ? (logMap.get(projKey) ?? []) : [];

    const lineValue = Number(ppLine.lineValue);
    const mean      = proj ? Number(proj.projectedValue) : lineValue;
    const rawStdDev = proj?.stdDev != null
      ? Number(proj.stdDev)
      : computeStdDev(logs) || mean * 0.35;

    simLegs.push({
      playerName: player?.fullName ?? `Player ${ppLine.playerId ?? input.ppLineId}`,
      statType:   ppLine.statType,
      line:       lineValue,
      side:       input.direction === "more" ? "over" : "under",
      modelProb:  input.modelProb,
      sport:      player?.sport ?? "NBA",
      team:       team?.abbreviation ?? "",
      gameId:     ppLine.gameId != null ? String(ppLine.gameId) : "",
      position:   player?.position ?? undefined,
      mean,
      stdDev: Math.max(rawStdDev, 0.01),
    });
  }

  if (simLegs.length === 0) {
    res.status(400).json({ error: "No valid legs found for simulation" });
    return;
  }

  const result = simulateEntry({ legs: simLegs, runs, multiplier });
  res.json(result);
});

export default router;
