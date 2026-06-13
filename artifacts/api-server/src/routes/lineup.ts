import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

function sseWrite(res: Response, data: string): void {
  res.write(`data: ${JSON.stringify({ text: data })}\n\n`);
}

// ── Request schema ────────────────────────────────────────────────────────────

const storyPickSchema = z.object({
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
    // Identify anchors (highest edge) and weakest leg (highest combined risk).
    const sortedByEdge = [...picks].sort((a, b) => (b.edgeScore ?? 0) - (a.edgeScore ?? 0));
    const anchors = sortedByEdge.slice(0, Math.min(2, picks.length));

    const weakestLeg = [...picks].sort((a, b) => {
      const score = (p: typeof picks[0]) => (p.riskScore ?? 0) * 1.5 + (1 - p.hitProbability) * 100;
      return score(b) - score(a);
    })[0];

    // Extract contextual signals from the pick pool.
    const sports      = [...new Set(picks.map(p => p.sport))];
    const gameTotals  = picks.map(p => p.gameTotal).filter((v): v is number => v != null);
    const avgTotal    = gameTotals.length > 0 ? gameTotals.reduce((a, b) => a + b, 0) / gameTotals.length : null;
    const paceSignal  = picks.map(p => p.paceTier).find(Boolean) ?? null;
    const sharpSignal = picks.map(p => p.sharpSignal).find(Boolean) ?? null;

    // Build a compact picks table (sorted by edge) for the prompt.
    const pickTable = sortedByEdge.map(p => {
      const dir  = p.direction === "more" ? "▲" : "▼";
      const edge = p.edgeScore  != null ? ` edge:${p.edgeScore.toFixed(0)}`  : "";
      const risk = p.riskScore  != null ? ` risk:${p.riskScore.toFixed(0)}`  : "";
      const prob = ` hit:${(p.hitProbability * 100).toFixed(0)}%`;
      const ctx  = [
        p.paceTier        ? `pace:${p.paceTier}`          : null,
        p.sharpSignal     ? `sharp:${p.sharpSignal}`      : null,
        p.gameTotal       ? `total:${p.gameTotal}`        : null,
        p.volatilityRating? `vol:${p.volatilityRating}`   : null,
      ].filter(Boolean).join(" ");
      return `• ${p.playerName} — ${p.statType} ${dir}${p.lineValue} (${p.sport}${edge}${risk}${prob}${ctx ? " " + ctx : ""})`;
    }).join("\n");

    const templateNote = storyTemplate ? `\nStory template: ${storyTemplate}` : "";
    const corrNote     = correlationPairs?.length
      ? `\nCorrelated pairs: ${correlationPairs.join(" | ")}`
      : "";

    const anchorNames  = anchors.map(a => a.playerName).join(" and ");
    const weakestName  = weakestLeg?.playerName ?? "the riskiest pick";

    const prompt = `You are a sports analytics AI writing a brief lineup narrative for a private PrizePicks analyst.

LINEUP:
Format: ${format.toUpperCase()} | ${picks.length}-pick | EV: ${ev >= 0 ? "+" : ""}$${ev.toFixed(2)} | Hit prob: ${(hitProbability * 100).toFixed(0)}% | Payout: $${grossPayout.toFixed(2)} (stake $${stake.toFixed(2)})${templateNote}${corrNote}
Sport(s): ${sports.join(", ")}${avgTotal ? ` | Avg game total: ${avgTotal.toFixed(0)}` : ""}${paceSignal ? ` | Pace: ${paceSignal}` : ""}${sharpSignal ? ` | Sharp money: ${sharpSignal}` : ""}

PICKS (sorted by edge score, highest first):
${pickTable}

Write a 3–5 sentence narrative covering ALL four points below in this order:
1. The anchor pick(s) — ${anchorNames} lead this lineup; state specifically WHY they anchor it (edge source, matchup, context)
2. The weakest leg — ${weakestName} carries the most risk; acknowledge it briefly
3. The entry thesis — what game environment, matchup, or narrative thread connects these picks
4. The recommended play style — ${format === "power" ? "Power" : "Flex"} is correct here; state why given this lineup's construction and EV profile

Style rules (strictly enforced):
- Second person ("your lineup", "this entry")
- Name actual players, cite actual lines, cite actual edges/probabilities
- Zero hedging — ban the words: "might", "could", "potentially", "likely", "possible", "may"
- Paragraph prose only — no bullet points, no headers, no lists
- Confident analyst register — write as if this analysis is certain, not speculative
- 3–5 sentences total. Do not exceed 5.`;

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
