import { Router } from "express";
import { db } from "@workspace/db";
import {
  ppLinesTable, playersTable, teamsTable,
  ourProjectionsTable, propScoresTable,
  injuriesTable, probabilityCalibrationTable,
} from "@workspace/db/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getAppContext, loadKnowledge } from "../lib/shark/app-contexts";

const router = Router();

const VIBEMEGOOD_SYSTEM_PROMPT = `You are a private pick'em analytics assistant for DeShaun, focused exclusively on VibeMeGood and PrizePicks pick'em strategy.

You help with:
- Reading and interpreting projection differences
- Entry construction and leg selection
- Break-even win rates by entry type
- Payout shift detection and correlation warnings
- Variance signals (fatigue, blowout risk, usage)
- The daily pick'em workflow
- Cross-tier expected value (standard vs demon vs goblin) and calibration tracking

You ask only one question per response.
You never fabricate current lines or projections.
You always check data freshness before advising.
You push back when the user is forcing action or skipping the workflow.

Do not build a hype bot. Build a shark.

=== SHARK UPGRADE: VEGAS SHARP MODE ===

IDENTITY EXPANSION:
You are not just a pick'em analytics assistant. You are a seasoned Vegas sharp who specializes in finding market inefficiencies in player prop markets. You know when PrizePicks has set a line too high or too low, when sharp money is confirming an edge, and when the public is walking into a trap.

EDGE-FINDING MODE:
When the user asks "where is the edge", "is this +EV", "give me your sharpest take", or similar — activate full sharp analyst mode:

1. State whether the play is +EV or -EV
2. Quantify: "true probability X%, break-even Y% — edge of Z%"
3. Flag any market inefficiency
4. Suggest better alternative if -EV
5. Always explain WHY

PP EDGE FRAMEWORK:
Walk through these 5 gates in order:

1. Sharp signal present?
   (line movement confirms direction)

2. Market gap meaningful?
   (PP line vs sportsbook > 1.5 pts)

3. True P(Over) > break-even?
   Power 2: >50%
   Power 3: >57.7%
   Power 4: >62.5%
   Power 5: >65.9%

4. Consistency gate?
   (std dev < 40% of projection)

5. Sample size adequate?
   <5 games = BLOCKED (minimum enforced)
   5-10 = low confidence
   10-20 = medium confidence
   >20 = high confidence

Only when ALL 5 passed = SHARP PLAY

LINE OVERRIDE WORKFLOW:
VibeMeGood now has a line override feature. Users click any line on the Slate Board to confirm the exact PP featured line. The model then recalculates P(Over) and shows ▲ MORE or ▼ LESS.

When a user shares an override result explain what the recalculated edge means and whether it changes the recommendation.

GOBLIN AND DEMON LINES:
PP offers multiple tiers per player.
Goblin lines (👹) = line below ~60% of projection — easy over, lower payout value
Demon lines (😈) = line above ~120% of projection — easy under, lower payout value
Standard lines = between 60-120% of projection — where real edge lives
★ BEST VALUE = this tier has the highest calibrated EV for this player

PAYOUT MULTIPLIERS (exact — never guess these):
Power:  2-pick=3×  | 3-pick=6×  | 4-pick=10× | 5-pick=20× | 6-pick=40×
Flex:   3-pick: 3/3=5× 2/3=1.25× | 4-pick: 4/4=10× 3/4=2.5× | 5-pick: 5/5=20× 4/5=4× 3/5=1×
        6-pick: 6/6=40× 5/6=6× 4/6=1.5×

Break-even P(hit) per leg for Power (formula: (1/M)^(1/N) — all legs must clear this):
Power 2: 57.7% | Power 3: 55.0% | Power 4: 56.2% | Power 5: 54.9% | Power 6: 54.1%
Note: break-even DECREASES as pick count rises because multipliers scale up to compensate.

BANKROLL GUIDANCE:
Kelly fraction = edge% / payout_multiplier_per_leg
Recommend Half Kelly for safety

Example: P(Over) = 62% on Power 2 leg (break-even 57.7%)
Edge = 4.3% | Kelly ≈ 4.3% / 3.0 ≈ 1.4% of bankroll per entry
Half Kelly = 0.7% per entry

PROFIT OPTIMIZATION (when user asks for max profit / best EV / highest edge):
Do NOT just chase P(Over)%. The correct target is:
  EV = P(leg hits) × payout_multiplier
For multi-leg entries:
  Entry EV = (P1 × P2 × ... × Pn) × entry_multiplier × stake

GOBLIN LINE TRAP — critical:
Goblin lines (0.5, extremely low) have sky-high P(Over) but PrizePicks knows this and
prices them accordingly with lower tier multipliers. They do NOT pay the same 3×/6×/10×
as standard lines on many platforms — or if they do, the edge is already priced in.

When user asks for MAX PROFIT, BEST VALUE, or HIGHEST EV:
1. First show ★BV (BEST VALUE) props — these are already verified to have higher P×M than goblin/demon alternatives for the same player
2. Prefer standard-line PLAY props over goblin PLAY props
3. Only include goblin lines if no standard PLAY exists for that player AND the goblin is ★BV
4. State the combined entry EV explicitly: (P1×P2×...×Pn) × multiplier

HIGH HIT-RATE ≠ HIGH PROFIT — never confuse the two when making recommendations.

SHARP QUERIES:
Support these naturally:

"Who is the sharp side?"
→ Analyze line movement, sharp vs square signals, give verdict

"Build a correlated entry"
→ Find players whose outcomes are linked (same game, pace spots, same team usage)
  Warn against negative correlations

"What is the market missing?"
→ Dig into usage, matchup, form, pace, injury context

"Is this a trap line?"
→ Check if PP line is set to attract public action on wrong side (goblin traps, public names, etc.)

COMMUNICATION STYLE:
Speak like a Vegas sharp:
- "The market is pricing this wrong"
- "Sharp money says..."
- "This is a trap line"
- "Public is heavy here"
- "I would fade this number"
- "This line has value at this number"

End every edge analysis with:
SHARP PLAY | LEAN | PASS | FADE

SESSION MEMORY:
Track within the conversation:
- Which sport and players mentioned
- Risk tolerance stated
- Specific props discussed
- Any confirmed line overrides

=== END SHARK UPGRADE ===`;

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// ── Live slate context injected into every Shark response ─────────────────────
// Pulls PLAY + ACTION props with calibrated probabilities, sharp signals, and
// any injuries affecting today's slate. Kept compact for Shark's system prompt.
async function buildSharkSlateContext(): Promise<string> {
  const today = new Date();

  try {
    const [topLines, allTeams, injuries, calStats] = await Promise.all([
      db.select({
        lineValue:      ppLinesTable.lineValue,
        statType:       ppLinesTable.statType,
        lineType:       ppLinesTable.lineType,
        playerName:     playersTable.fullName,
        playerTeamId:   playersTable.teamId,
        sport:          playersTable.sport,
        pOver:          ourProjectionsTable.pOver,
        projectedValue: ourProjectionsTable.projectedValue,
        stdDev:         ourProjectionsTable.stdDev,
        gamesUsed:      ourProjectionsTable.gamesUsed,
        noPlayReason:   ourProjectionsTable.noPlayReason,
        actionTag:      propScoresTable.actionTag,
        edgeScore:      propScoresTable.edgeScore,
        riskScore:      propScoresTable.riskScore,
        finalScore:     propScoresTable.finalScore,
        recommendedSide:propScoresTable.recommendedSide,
        bestTier:       propScoresTable.bestTierInGroup,
        reasoning:      propScoresTable.reasoning,
      })
        .from(ppLinesTable)
        .innerJoin(playersTable,        eq(ppLinesTable.playerId, playersTable.id))
        .innerJoin(propScoresTable,     eq(propScoresTable.ppLineId, ppLinesTable.id))
        .leftJoin(ourProjectionsTable,  and(
          eq(ourProjectionsTable.playerId, ppLinesTable.playerId),
          eq(ourProjectionsTable.statType, ppLinesTable.statType),
        ))
        .where(and(
          eq(ppLinesTable.isActive, true),
          inArray(propScoresTable.actionTag, ["PLAY", "ACTION"]),
        ))
        .orderBy(desc(propScoresTable.finalScore))
        .limit(30),

      db.select().from(teamsTable),

      db.select().from(injuriesTable)
        .orderBy(desc(injuriesTable.reportedAt))
        .limit(12),

      db.select({ cnt: sql<number>`count(*)` }).from(probabilityCalibrationTable),
    ]);

    const teamMap    = Object.fromEntries(allTeams.map(t => [t.id, t]));
    const calBuckets = Number(calStats[0]?.cnt ?? 0);

    const plays   = topLines.filter(l => l.actionTag === "PLAY");
    const actions = topLines.filter(l => l.actionTag === "ACTION");

    // Resolve injury players
    const injPlayerIds = [...new Set(injuries.map(i => i.playerId))];
    const injPlayers   = injPlayerIds.length
      ? await db.select().from(playersTable).where(inArray(playersTable.id, injPlayerIds))
      : [];
    const injPlayerMap = Object.fromEntries(injPlayers.map(p => [p.id, p]));

    // Injuries that overlap the slate
    const slateNames = new Set(topLines.map(l => l.playerName));
    const slateInjuries = injuries.filter(inj => {
      const p = injPlayerMap[inj.playerId];
      return p && slateNames.has(p.fullName) && (inj.status === "out" || inj.status === "gtd");
    });

    function fmtProp(l: typeof topLines[0]): string {
      const team  = l.playerTeamId ? teamMap[l.playerTeamId] : null;
      const abbr  = team?.abbreviation ?? "?";
      const pOv   = l.pOver != null ? Math.round(Number(l.pOver) * 10) / 10 : "?";
      const proj  = l.projectedValue != null ? Number(l.projectedValue).toFixed(1) : "?";
      const std   = l.stdDev   != null ? Number(l.stdDev).toFixed(1)   : "?";
      const edge  = l.edgeScore != null ? Number(l.edgeScore).toFixed(0) : "?";
      const n     = l.gamesUsed ?? "?";
      const side  = l.recommendedSide?.toUpperCase() ?? "?";
      const tier  = l.lineType === "goblin" ? "👹" : l.lineType === "demon" ? "😈" : "";
      const bv    = l.bestTier ? " ★BV" : "";
      const r     = l.reasoning as Record<string, unknown> | null;
      const sharp = r?.sharpSignal && r.sharpSignal !== "neutral"
        ? ` ⚡${String(r.sharpSignal).toUpperCase()}` : "";
      const mkt   = r?.marketEdge != null ? ` MktEdge:${r.marketEdge}%` : "";
      return `  ${l.playerName} (${abbr}) ${l.sport} | ${l.statType}${tier} ${l.lineValue} | P(${side}):${pOv}% | Model:${proj}±${std} | Edge:${edge} | N:${n}${sharp}${mkt}${bv}`;
    }

    const lines: string[] = [
      `=== TODAY'S LIVE SLATE — ${today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ===`,
      `Model: Poisson/NegBin/ZIP/Log-normal distributions, Bayesian shrinkage, ${calBuckets} calibration buckets.`,
      `P(Over) values are CALIBRATED against historical hit rates.`,
      `Power payouts: 2=3× | 3=6× | 4=10× | 5=20× | 6=40×. Break-even per leg: P2=57.7% P3=55.0% P4=56.2% P5=54.9% P6=54.1%`,
      `★BV = highest calibrated EV tier for that player. Prefer ★BV standard lines over goblins for max profit.`,
      "",
    ];

    if (plays.length > 0) {
      lines.push(`▶ PLAY PROPS — All 5 gates passed (${plays.length} props):`);
      plays.forEach(l => lines.push(fmtProp(l)));
      lines.push("");
    }

    if (actions.length > 0) {
      lines.push(`▶ ACTION PROPS — Strong signal (${actions.length} props):`);
      actions.slice(0, 12).forEach(l => lines.push(fmtProp(l)));
      lines.push("");
    }

    if (plays.length === 0 && actions.length === 0) {
      lines.push("No PLAY or ACTION props on current slate.");
      lines.push("Tell user to run Settings → Sync Projections → Rescore Props.");
      lines.push("");
    }

    if (slateInjuries.length > 0) {
      lines.push("⚠ SLATE INJURIES (OUT/GTD):");
      slateInjuries.forEach(inj => {
        const p = injPlayerMap[inj.playerId];
        if (p) lines.push(`  • ${p.fullName} — ${inj.status.toUpperCase()} — ${inj.note ?? ""}`);
      });
      lines.push("");
    }

    lines.push("=== END LIVE SLATE ===");
    return lines.join("\n");

  } catch {
    // Fallback: don't break the chat if DB query fails
    return `=== LIVE SLATE — ${today.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ===\nSlate data unavailable — sync required.\n=== END LIVE SLATE ===`;
  }
}

router.post("/shark/chat", async (req, res): Promise<void> => {
  try {
    const { message, app = "vibemegood", conversationHistory = [] } = req.body as {
      message: string;
      app?: string;
      conversationHistory?: ConversationTurn[];
    };

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const ctx           = getAppContext(app);
    const knowledge     = loadKnowledge(ctx.knowledgeFolders);
    const slateContext  = await buildSharkSlateContext();

    const systemPrompt = [
      ctx.systemPromptPrefix,
      "",
      VIBEMEGOOD_SYSTEM_PROMPT,
      "",
      "=== LIVE DATA FROM YOUR ANALYTICS SYSTEM ===",
      "The following is REAL DATA pulled from your personal PrizePicks Analytics Workstation.",
      "These props have been scored by the model you've built. Use them. Do not guess or fabricate numbers.",
      slateContext,
      "=== END LIVE DATA ===",
      "",
      "=== KNOWLEDGE BASE ===",
      knowledge || "No knowledge files found — answer from general expertise.",
    ].join("\n");

    const safeHistory: ConversationTurn[] = Array.isArray(conversationHistory)
      ? conversationHistory.filter(
          m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
        )
      : [];

    const messages: ConversationTurn[] = [
      ...safeHistory.slice(-20),
      { role: "user", content: message },
    ];

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const reply = response.content
      .filter(b => b.type === "text")
      .map(b => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    res.json({ reply });
  } catch (err) {
    req.log.error(err, "Shark chat failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
