import { Router } from "express";
import { db } from "@workspace/db";
import {
  lineMoveEventsTable, ppLinesTable, playersTable,
} from "@workspace/db/schema";
import { gte, and, eq, inArray, desc } from "drizzle-orm";
import { detectAllSharpSignals, detectSharpMoney } from "../lib/propedge/sharp-detector";
import { logger } from "../lib/logger";

const router = Router();

// ── POST /sharp/compute ───────────────────────────────────────────────────────
// Runs detection on all line moves from the last 24h and stores results.
router.post("/sharp/compute", async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const moves = await db
      .select()
      .from(lineMoveEventsTable)
      .where(gte(lineMoveEventsTable.capturedAt, since))
      .orderBy(desc(lineMoveEventsTable.capturedAt));

    const signalMap = detectAllSharpSignals(moves);

    let sharpCount   = 0;
    let publicCount  = 0;
    let neutralCount = 0;

    // Collect ppLineIds that have sharp signals
    const updates: Array<{ ppLineId: number; signal: string; confidence: string; explanation: string }> = [];
    for (const [ppLineId, result] of signalMap) {
      updates.push({
        ppLineId,
        signal:      result.signal,
        confidence:  result.confidence,
        explanation: result.explanation,
      });
      if (result.signal === "sharp")   sharpCount++;
      else if (result.signal === "public") publicCount++;
      else                             neutralCount++;
    }

    // Batch update: for each ppLineId, update all its moves with the computed signal
    for (const u of updates) {
      const ppLineIds = [u.ppLineId];
      await db
        .update(lineMoveEventsTable)
        .set({
          sharpSignal:      u.signal,
          sharpConfidence:  u.confidence,
          sharpExplanation: u.explanation,
        })
        .where(
          and(
            inArray(lineMoveEventsTable.ppLineId, ppLineIds),
            gte(lineMoveEventsTable.capturedAt, since),
          ),
        );
    }

    logger.info({ sharpCount, publicCount, neutralCount, total: signalMap.size }, "Sharp signals computed");
    res.json({ status: "ok", sharpCount, publicCount, neutralCount, total: signalMap.size });
  } catch (err) {
    logger.error(err, "Sharp compute failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /sharp/signals ────────────────────────────────────────────────────────
// Returns all ppLineIds with a sharp signal today, with player/stat context.
router.get("/sharp/signals", async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get all lines that have sharp signals
    const sharpMoves = await db
      .selectDistinct({ ppLineId: lineMoveEventsTable.ppLineId })
      .from(lineMoveEventsTable)
      .where(
        and(
          gte(lineMoveEventsTable.capturedAt, since),
          eq(lineMoveEventsTable.sharpSignal, "sharp"),
        ),
      );

    if (sharpMoves.length === 0) return void res.json([]);

    const ppLineIds = sharpMoves.map(m => m.ppLineId!).filter(Boolean);
    const lines = await db
      .select({
        id:        ppLinesTable.id,
        playerId:  ppLinesTable.playerId,
        statType:  ppLinesTable.statType,
        lineValue: ppLinesTable.lineValue,
      })
      .from(ppLinesTable)
      .where(inArray(ppLinesTable.id, ppLineIds));

    const playerIds = [...new Set(lines.map(l => l.playerId))];
    const players = playerIds.length
      ? await db
          .select({ id: playersTable.id, fullName: playersTable.fullName, sport: playersTable.sport })
          .from(playersTable)
          .where(inArray(playersTable.id, playerIds))
      : [];

    const playerMap    = Object.fromEntries(players.map(p => [p.id, p.fullName]));
    const sportMap     = Object.fromEntries(players.map(p => [p.id, p.sport]));

    // Get one representative move per ppLineId (most recent with sharp signal)
    const allMoves = await db
      .select()
      .from(lineMoveEventsTable)
      .where(
        and(
          inArray(lineMoveEventsTable.ppLineId, ppLineIds),
          gte(lineMoveEventsTable.capturedAt, since),
        ),
      )
      .orderBy(desc(lineMoveEventsTable.capturedAt));

    const movesByPpLineId = new Map<number, typeof allMoves>();
    for (const m of allMoves) {
      if (!m.ppLineId) continue;
      if (!movesByPpLineId.has(m.ppLineId)) movesByPpLineId.set(m.ppLineId, []);
      movesByPpLineId.get(m.ppLineId)!.push(m);
    }

    const result = lines.map(line => {
      const moves = movesByPpLineId.get(line.id) ?? [];
      const detection = detectSharpMoney(moves);
      return {
        ppLineId:           line.id,
        playerName:         playerMap[line.playerId] ?? "Unknown",
        statType:           line.statType,
        lineValue:          Number(line.lineValue),
        sport:              sportMap[line.playerId] ?? "unknown",
        signal:             detection.signal,
        confidence:         detection.confidence,
        explanation:        detection.explanation,
        estimatedPublicPct: detection.estimatedPublicPct,
        sharpSide:          detection.sharpSide,
        publicSide:         detection.publicSide,
        moveCount:          moves.length,
      };
    }).filter(r => r.signal === "sharp");

    res.json(result);
  } catch (err) {
    logger.error(err, "Sharp signals fetch failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /sharp/summary ────────────────────────────────────────────────────────
// Count of sharp / public / neutral for today (health check support).
router.get("/sharp/summary", async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const moves = await db
      .select()
      .from(lineMoveEventsTable)
      .where(gte(lineMoveEventsTable.capturedAt, since));

    const signalMap = detectAllSharpSignals(moves);
    let sharp = 0, publicCount = 0, neutral = 0;
    for (const r of signalMap.values()) {
      if (r.signal === "sharp")        sharp++;
      else if (r.signal === "public")  publicCount++;
      else                             neutral++;
    }
    res.json({ sharp, public: publicCount, neutral, total: signalMap.size });
  } catch (err) {
    logger.error(err, "Sharp summary failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
