import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, playersTable, gamesTable, propScoresTable,
  projectionsTable, externalLinesTable, injuriesTable,
  lineupConfirmationsTable, entriesTable, entryPicksTable,
  varianceScoresTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

function sseWrite(res: Response, data: string): void {
  res.write(`data: ${JSON.stringify({ text: data })}\n\n`);
}

async function streamAnthropicToSSE(res: Response, prompt: string): Promise<void> {
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      sseWrite(res, event.delta.text);
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
}

router.post("/explain/prop/:id", async (req: Request, res: Response): Promise<void> => {
  const lineId = Number(req.params.id);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const [line] = await db.select().from(ppLinesTable).where(eq(ppLinesTable.id, lineId));
    if (!line) {
      sseWrite(res, "Error: Prop not found.");
      res.end();
      return;
    }

    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, line.playerId));
    const [score] = await db.select().from(propScoresTable).where(eq(propScoresTable.ppLineId, lineId));
    const projections = await db.select().from(projectionsTable)
      .where(and(eq(projectionsTable.playerId, line.playerId), eq(projectionsTable.statType, line.statType)));
    const externalLines = await db.select().from(externalLinesTable)
      .where(and(eq(externalLinesTable.playerId, line.playerId), eq(externalLinesTable.statType, line.statType)));
    const injuries = await db.select().from(injuriesTable).where(eq(injuriesTable.playerId, line.playerId));
    const game = line.gameId
      ? (await db.select().from(gamesTable).where(eq(gamesTable.id, line.gameId)))[0] ?? null
      : null;
    const [varScore] = await db.select({
      whyItMoves: varianceScoresTable.whyItMoves,
      fatigueScore: varianceScoresTable.fatigueScore,
      blowoutRisk: varianceScoresTable.blowoutRisk,
      usageScore: varianceScoresTable.usageScore,
      matchupScore: varianceScoresTable.matchupScore,
      volatilityRating: varianceScoresTable.volatilityRating,
      warnings: varianceScoresTable.warnings,
      evModifier: varianceScoresTable.evModifier,
    }).from(varianceScoresTable).where(eq(varianceScoresTable.ppLineId, lineId));
    const lineupConfs = line.gameId
      ? await db.select().from(lineupConfirmationsTable)
          .where(and(eq(lineupConfirmationsTable.playerId, line.playerId), eq(lineupConfirmationsTable.gameId, line.gameId)))
      : [];

    const context = {
      player: { name: player?.fullName, sport: player?.sport, position: player?.position, status: player?.status },
      prop: { statType: line.statType, lineValue: Number(line.lineValue), lineType: line.lineType, directionality: line.directionalityType },
      game: game ? { startTime: game.startTime, sport: game.sport, spread: game.spread, total: game.total } : null,
      variance: varScore ? {
        whyItMoves: varScore.whyItMoves,
        volatilityRating: varScore.volatilityRating,
        fatigueScore: varScore.fatigueScore,
        blowoutRisk: varScore.blowoutRisk,
        usageScore: varScore.usageScore,
        matchupScore: varScore.matchupScore,
        evModifier: varScore.evModifier,
        warnings: varScore.warnings,
      } : null,
      scores: score ? {
        edge: Number(score.edgeScore), stability: Number(score.stabilityScore),
        marketSupport: Number(score.marketSupportScore), risk: Number(score.riskScore),
        final: Number(score.finalScore), actionTag: score.actionTag,
        reasoning: score.reasoning,
      } : null,
      projection: projections[0] ? {
        value: Number(projections[0].projectedValue),
        floor: Number(projections[0].floorValue),
        ceiling: Number(projections[0].ceilingValue),
        confidence: Number(projections[0].confidenceScore),
        source: projections[0].projectionSource,
      } : null,
      externalLines: externalLines.map(el => ({
        book: el.bookName, overLine: Number(el.overLine), underLine: Number(el.underLine),
        noVigOverProb: el.noVigOverProb ? Number(el.noVigOverProb) : null,
        noVigUnderProb: el.noVigUnderProb ? Number(el.noVigUnderProb) : null,
      })),
      injuries: injuries.map(i => ({ status: i.status, note: i.note, reportedAt: i.reportedAt })),
      lineupStatus: lineupConfs[0] ? {
        isStarting: lineupConfs[0].isStarting,
        expectedMinutes: lineupConfs[0].expectedMinutes ? Number(lineupConfs[0].expectedMinutes) : null,
      } : null,
    };

    const varianceSection = varScore?.whyItMoves
      ? `\n\nVariance context: ${varScore.whyItMoves}${varScore.warnings && Array.isArray(varScore.warnings) && varScore.warnings.length > 0 ? ` Warnings: ${(varScore.warnings as string[]).join(", ")}.` : ""}${varScore.evModifier && varScore.evModifier !== "0" ? ` EV modifier applied: ${(parseFloat(varScore.evModifier.toString()) * 100).toFixed(0)}%.` : ""}`
      : "";

    const prompt = `You are an expert sports analytics AI helping a private analyst understand a PrizePicks prop.

Here is the full data context for this prop:
${JSON.stringify(context, null, 2)}${varianceSection}

Provide a concise but thorough analysis of this prop. Cover:
1. The edge and why it exists (or doesn't)
2. Key data points supporting or undermining the play
3. Risk factors (injuries, lineup, variance, lineType implications)${varScore ? "\n4. Contextual variance factors (fatigue, blowout risk, usage trends)" : ""}
${varScore ? "5." : "4."} Your overall assessment and suggested direction (More/Less)

Be direct and analytical. No filler. This is a private tool for someone who knows what they're doing.`;

    await streamAnthropicToSSE(res, prompt);
    res.end();
  } catch (err) {
    req.log.error(err);
    sseWrite(res, "Analysis failed. Please try again.");
    res.end();
  }
});

router.post("/explain/entry/:id", async (req: Request, res: Response): Promise<void> => {
  const entryId = Number(req.params.id);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const [entry] = await db.select().from(entriesTable).where(eq(entriesTable.id, entryId));
    if (!entry) {
      sseWrite(res, "Error: Entry not found.");
      res.end();
      return;
    }

    const picks = await db.select().from(entryPicksTable).where(eq(entryPicksTable.entryId, entryId));

    const context = {
      entry: {
        date: entry.entryDate, type: entry.entryType, pickCount: entry.pickCount,
        stake: Number(entry.stake), potentialPayout: entry.potentialPayout ? Number(entry.potentialPayout) : null,
        result: entry.result, notes: entry.notes,
      },
      picks: picks.map(p => ({
        statType: p.statType, direction: p.direction, lineValue: Number(p.lineValue), lineType: p.lineType,
        yourProjection: p.yourProjection ? Number(p.yourProjection) : null,
        projectionGap: p.projectionGap ? Number(p.projectionGap) : null,
        result: p.result, clv: p.clv ? Number(p.clv) : null,
      })),
    };

    const prompt = `You are a sports betting analytics AI. Analyze this PrizePicks entry:
${JSON.stringify(context, null, 2)}

Cover:
1. Overall entry construction quality
2. Correlation risks between picks
3. Best and weakest legs
4. What this entry reveals about the analyst's approach
5. Lessons if the entry has a result, or actionable notes if still pending

Be direct and useful. No filler.`;

    await streamAnthropicToSSE(res, prompt);
    res.end();
  } catch (err) {
    req.log.error(err);
    sseWrite(res, "Analysis failed. Please try again.");
    res.end();
  }
});

export default router;
