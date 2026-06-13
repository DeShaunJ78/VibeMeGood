import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ppLinesTable, injuriesTable, varianceScoresTable,
} from "@workspace/db/schema";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

function sseWrite(res: Response, data: string): void {
  res.write(`data: ${JSON.stringify({ text: data })}\n\n`);
}

// ── Request schema ────────────────────────────────────────────────────────────

const storyPickSchema = z.object({
  ppLineId:        z.number().optional(),
  playerName:      z.string(),
  statType:        z.string(),
  direction:       z.enum(["more", "less"]),
  lineValue:       z.number(),
  hitProbability:  z.number(),
  edgeScore:       z.number().nullable().optional(),
  riskScore:       z.number().nullable().optional(),
  lineType:        z.string(),
  team:            z.string(),
  sport:           z.string(),
  paceTier:        z.string().nullable().optional(),
  sharpSignal:     z.string().nullable().optional(),
  gameTotal:       z.number().nullable().optional(),
  volatilityRating:z.string().nullable().optional(),
});

const storyRequestSchema = z.object({
  picks:            z.array(storyPickSchema).min(1).max(10),
  format:           z.string(),
  ev:               z.number(),
  hitProbability:   z.number(),
  grossPayout:      z.number(),
  stake:            z.number(),
  correlationPairs: z.array(z.string()).nullable().optional(),
  storyTemplate:    z.string().nullable().optional(),
});

// ── POST /lineup/story — Claude narrative for a generated lineup (SSE) ────────

router.post("/lineup/story", async (req: Request, res: Response): Promise<void> => {
  const parsed = storyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { picks, format, ev, hitProbability, grossPayout, stake, correlationPairs, storyTemplate } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    // ── DB enrichment ────────────────────────────────────────────────────────
    const ppLineIds = picks.map(p => p.ppLineId).filter((id): id is number => id != null);

    const [ppLineRows, varianceRows] = await Promise.all([
      ppLineIds.length > 0
        ? db.select({ id: ppLinesTable.id, playerId: ppLinesTable.playerId })
            .from(ppLinesTable)
            .where(inArray(ppLinesTable.id, ppLineIds))
        : Promise.resolve([]),
      ppLineIds.length > 0
        ? db.select({
            ppLineId:        varianceScoresTable.ppLineId,
            whyItMoves:      varianceScoresTable.whyItMoves,
            warnings:        varianceScoresTable.warnings,
            volatilityRating:varianceScoresTable.volatilityRating,
            fatigueScore:    varianceScoresTable.fatigueScore,
            blowoutRisk:     varianceScoresTable.blowoutRisk,
          }).from(varianceScoresTable)
            .where(inArray(varianceScoresTable.ppLineId, ppLineIds))
        : Promise.resolve([]),
    ]);

    const playerIds = ppLineRows.map(r => r.playerId).filter((id): id is number => id != null);
    const injuryRows = playerIds.length > 0
      ? await db
          .select({ playerId: injuriesTable.playerId, status: injuriesTable.status, note: injuriesTable.note })
          .from(injuriesTable)
          .where(inArray(injuriesTable.playerId, playerIds))
      : [];

    const varMap      = new Map(varianceRows.map(v => [v.ppLineId, v]));
    const injuryMap   = new Map(injuryRows.map(i => [i.playerId, i]));
    const playerIdMap = new Map(ppLineRows.map(r => [r.id, r.playerId]));

    // ── Identify anchors / weakest leg ───────────────────────────────────────
    const sortedByEdge = [...picks].sort((a, b) => (b.edgeScore ?? 0) - (a.edgeScore ?? 0));
    const anchors = sortedByEdge.slice(0, Math.min(2, picks.length));
    const weakestLeg = [...picks].sort((a, b) => {
      const score = (p: typeof picks[0]) => (p.riskScore ?? 0) * 1.5 + (1 - p.hitProbability) * 100;
      return score(b) - score(a);
    })[0];

    // ── Extract game/pace signals ────────────────────────────────────────────
    const sports     = [...new Set(picks.map(p => p.sport))];
    const gameTotals = picks.map(p => p.gameTotal).filter((v): v is number => v != null);
    const avgTotal   = gameTotals.length > 0 ? gameTotals.reduce((a, b) => a + b, 0) / gameTotals.length : null;
    const paceSignal = picks.map(p => p.paceTier).find(Boolean) ?? null;
    const sharpSig   = picks.map(p => p.sharpSignal).find(Boolean) ?? null;

    // ── Build enriched picks table ───────────────────────────────────────────
    const pickTable = sortedByEdge.map(p => {
      const varScore = p.ppLineId ? varMap.get(p.ppLineId) ?? null : null;
      const playerId = p.ppLineId ? playerIdMap.get(p.ppLineId) : null;
      const injury   = playerId   ? injuryMap.get(playerId) ?? null : null;

      const dir  = p.direction === "more" ? "▲" : "▼";
      const edge = p.edgeScore  != null ? ` edge:${p.edgeScore.toFixed(0)}`  : "";
      const risk = p.riskScore  != null ? ` risk:${p.riskScore.toFixed(0)}`  : "";
      const prob = ` hit:${(p.hitProbability * 100).toFixed(0)}%`;

      const ctx = [
        p.paceTier         ? `pace:${p.paceTier}`                                                                       : null,
        p.sharpSignal      ? `sharp:${p.sharpSignal}`                                                                   : null,
        p.gameTotal        ? `game-total:${p.gameTotal}`                                                                : null,
        (p.volatilityRating ?? varScore?.volatilityRating) ? `vol:${p.volatilityRating ?? varScore?.volatilityRating}`  : null,
        injury             ? `injury:${injury.status}${injury.note ? ` (${injury.note})` : ""}`                         : null,
        varScore?.whyItMoves ? `why-it-moves:${varScore.whyItMoves}`                                                    : null,
        varScore?.fatigueScore != null ? `fatigue:${varScore.fatigueScore}/100`                                         : null,
        varScore?.blowoutRisk  != null ? `blowout-risk:${varScore.blowoutRisk}/100`                                     : null,
        varScore?.warnings && Array.isArray(varScore.warnings) && varScore.warnings.length > 0
          ? `warnings:${(varScore.warnings as string[]).join(",")}`
          : null,
      ].filter(Boolean).join(" | ");

      return `• ${p.playerName} — ${p.statType} ${dir}${p.lineValue} (${p.sport}${edge}${risk}${prob}${ctx ? " | " + ctx : ""})`;
    }).join("\n");

    // ── Build prompt ─────────────────────────────────────────────────────────
    const templateNote = storyTemplate ? `\nStory template: ${storyTemplate}` : "";
    const corrNote     = correlationPairs?.length
      ? `\nCorrelated pairs: ${correlationPairs.join(" | ")}`
      : "";

    const anchorNames = anchors.map(a => a.playerName).join(" and ");
    const weakestName = weakestLeg?.playerName ?? "the riskiest pick";

    const prompt = `You are a sports analytics AI writing a brief lineup narrative for a private PrizePicks analyst.

LINEUP:
Format: ${format.toUpperCase()} | ${picks.length}-pick | EV: ${ev >= 0 ? "+" : ""}$${ev.toFixed(2)} | Hit prob: ${(hitProbability * 100).toFixed(0)}% | Payout: $${grossPayout.toFixed(2)} (stake $${stake.toFixed(2)})${templateNote}${corrNote}
Sport(s): ${sports.join(", ")}${avgTotal ? ` | Avg game total: ${avgTotal.toFixed(0)}` : ""}${paceSignal ? ` | Pace: ${paceSignal}` : ""}${sharpSig ? ` | Sharp money: ${sharpSig}` : ""}

PICKS — sorted by edge score (highest anchor → weakest leg). DB-enriched context included where available:
${pickTable}

Write a 3–5 sentence narrative covering ALL four points below in this order:
1. The anchor pick(s) — ${anchorNames} lead this lineup; state specifically WHY they anchor it (edge source, matchup, DB context such as variance/why-it-moves if present)
2. The weakest leg — ${weakestName} carries the most risk; acknowledge the specific risk concisely (injury status, blowout-risk, fatigue if DB enriched)
3. The entry thesis — what game environment, matchup, or narrative thread connects these picks (use game-total, pace, sharp signal if present)
4. The recommended play style — ${format === "power" ? "Power" : "Flex"} is correct here; state why given this lineup's EV and construction

Style rules (strictly enforced):
- Second person ("your lineup", "this entry")
- Name actual players, cite actual lines, reference actual edges/probabilities and DB context
- Zero hedging — ban these words: "might", "could", "potentially", "likely", "possible", "may"
- Paragraph prose only — no bullet points, no headers, no lists
- Confident analyst register — treat the analysis as certain, not speculative
- 3–5 sentences total, do not exceed 5`;

    // ── Stream Anthropic response ─────────────────────────────────────────────
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 450,
      messages: [{ role: "user", content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        sseWrite(res, event.delta.text);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error(err);
    sseWrite(res, "Story generation failed. Please try again.");
    res.end();
  }
});

export default router;
