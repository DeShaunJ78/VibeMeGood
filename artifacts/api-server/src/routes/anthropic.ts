import { Router } from "express";
import { db } from "@workspace/db";
import {
  conversations, messages,
  ourProjectionsTable, watchlistItemsTable, injuriesTable,
  entriesTable, playersTable, teamsTable, ppLinesTable,
  propScoresTable, gamesTable, probabilityCalibrationTable,
} from "@workspace/db/schema";
import { eq, desc, isNotNull, inArray, and, asc, gte, lte, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// ── Full slate context for the AI analyst ────────────────────────────────────
// Fetches everything in one parallel batch: active lines + scoring + projections
// + today's schedule + injuries + entries + calibration stats.
async function buildAnalystContext(): Promise<string> {
  const today  = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayEnd   = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [activeLinesRaw, allTeams, todayGames, injuries, recentEntries, pendingEntries, watchRows, calStats] =
    await Promise.all([
      // Full active slate: lines joined with projections and scores
      db.select({
        lineId:         ppLinesTable.id,
        lineValue:      ppLinesTable.lineValue,
        statType:       ppLinesTable.statType,
        lineType:       ppLinesTable.lineType,
        playerId:       playersTable.id,
        playerName:     playersTable.fullName,
        playerTeamId:   playersTable.teamId,
        sport:          playersTable.sport,
        projectedValue: ourProjectionsTable.projectedValue,
        pOver:          ourProjectionsTable.pOver,
        stdDev:         ourProjectionsTable.stdDev,
        gamesUsed:      ourProjectionsTable.gamesUsed,
        confidence:     ourProjectionsTable.confidence,
        noPlayReason:   ourProjectionsTable.noPlayReason,
        actionTag:      propScoresTable.actionTag,
        edgeScore:      propScoresTable.edgeScore,
        riskScore:      propScoresTable.riskScore,
        finalScore:     propScoresTable.finalScore,
        recommendedSide:propScoresTable.recommendedSide,
        evValue:        propScoresTable.evValue,
        bestTier:       propScoresTable.bestTierInGroup,
        reasoning:      propScoresTable.reasoning,
      })
        .from(ppLinesTable)
        .innerJoin(playersTable,       eq(ppLinesTable.playerId, playersTable.id))
        .leftJoin(ourProjectionsTable, and(
          eq(ourProjectionsTable.playerId,  ppLinesTable.playerId),
          eq(ourProjectionsTable.statType,  ppLinesTable.statType),
        ))
        .leftJoin(propScoresTable, eq(propScoresTable.ppLineId, ppLinesTable.id))
        .where(eq(ppLinesTable.isActive, true)),

      db.select().from(teamsTable),

      db.select().from(gamesTable)
        .where(and(gte(gamesTable.startTime, dayStart), lte(gamesTable.startTime, dayEnd)))
        .orderBy(asc(gamesTable.startTime)),

      db.select().from(injuriesTable).orderBy(desc(injuriesTable.reportedAt)).limit(15),

      db.select().from(entriesTable)
        .where(inArray(entriesTable.result, ["win", "loss", "partial", "refund"]))
        .orderBy(desc(entriesTable.entryDate))
        .limit(30),

      db.select().from(entriesTable).where(eq(entriesTable.result, "pending")),

      db.select().from(watchlistItemsTable).limit(20),

      db.select({ cnt: sql<number>`count(*)` }).from(probabilityCalibrationTable),
    ]);

  const teamMap = Object.fromEntries(allTeams.map(t => [t.id, t]));

  // ── Slate grouping ────────────────────────────────────────────────────────
  const plays   = activeLinesRaw.filter(l => l.actionTag === "PLAY");
  const actions = activeLinesRaw.filter(l => l.actionTag === "ACTION");
  const watches = activeLinesRaw.filter(l => l.actionTag === "WATCH");
  const noPlay  = activeLinesRaw.filter(l => l.noPlayReason && (!l.actionTag || l.actionTag === "PASS" || l.actionTag === "NO-PLAY"));

  // ── Line formatter ────────────────────────────────────────────────────────
  function fmtLine(l: typeof activeLinesRaw[0], idx?: number): string {
    const team     = l.playerTeamId ? teamMap[l.playerTeamId] : null;
    const abbr     = team?.abbreviation ?? "?";
    const pOv      = l.pOver           != null ? Math.round(Number(l.pOver) * 10) / 10 : null;
    const proj     = l.projectedValue  != null ? Number(l.projectedValue).toFixed(1)   : "?";
    const std      = l.stdDev          != null ? Number(l.stdDev).toFixed(1)           : "?";
    const edge     = l.edgeScore       != null ? Number(l.edgeScore).toFixed(0)        : "?";
    const risk     = l.riskScore       != null ? Number(l.riskScore).toFixed(0)        : "?";
    const games    = l.gamesUsed ?? "?";
    const side     = l.recommendedSide?.toUpperCase() ?? "?";
    const tier     = l.lineType === "goblin" ? " [👹GOBLIN]" : l.lineType === "demon" ? " [😈DEMON]" : "";
    const r        = l.reasoning as Record<string, unknown> | null;
    const mktEdge  = r?.marketEdge  != null ? ` | MktEdge:${r.marketEdge}%`                         : "";
    const sharp    = r?.sharpSignal && r.sharpSignal !== "neutral" ? ` | ⚡${String(r.sharpSignal).toUpperCase()}` : "";
    const best     = l.bestTier ? " | ★BV" : "";
    const gated    = l.noPlayReason ? ` | GATED:${l.noPlayReason}` : "";
    const prefix   = idx != null ? `${idx}. ` : "   • ";
    return `${prefix}${l.playerName} (${abbr}) — ${l.statType}${tier} | Line:${l.lineValue} Model:${proj}±${std} P(${side}):${pOv ?? "?"}% Edge:${edge} Risk:${risk} N:${games}${mktEdge}${sharp}${best}${gated}`;
  }

  // ── Game schedule ─────────────────────────────────────────────────────────
  const schedLines: string[] = [];
  const gamesBySport: Record<string, typeof todayGames> = {};
  for (const g of todayGames) {
    (gamesBySport[g.sport] ??= []).push(g);
  }
  for (const [sport, gs] of Object.entries(gamesBySport)) {
    schedLines.push(`  [${sport}]`);
    for (const g of gs) {
      const home  = teamMap[g.homeTeamId]?.abbreviation ?? "?";
      const away  = teamMap[g.awayTeamId]?.abbreviation ?? "?";
      const time  = g.startTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
      const total = g.total  ? ` O/U:${g.total}` : "";
      const sprd  = g.spread ? ` Sprd:${g.spread}` : "";
      schedLines.push(`    ${away}@${home} ${time}ET${sprd}${total}`);
    }
  }

  // ── Injuries ──────────────────────────────────────────────────────────────
  const injPlayerIds = [...new Set(injuries.map(i => i.playerId))];
  const injPlayers   = injPlayerIds.length
    ? await db.select().from(playersTable).where(inArray(playersTable.id, injPlayerIds))
    : [];
  const injPlayerMap = Object.fromEntries(injPlayers.map(p => [p.id, p]));
  const injLines     = injuries.map(i => {
    const p = injPlayerMap[i.playerId]; if (!p) return null;
    const t = p.teamId ? teamMap[p.teamId] : null;
    return `  • ${p.fullName} (${t?.abbreviation ?? "?"}) — ${i.status.toUpperCase()} — ${i.note ?? "no note"}`;
  }).filter(Boolean) as string[];

  // ── Watchlist ─────────────────────────────────────────────────────────────
  const watchKeys   = new Set(watchRows.map(w => `${w.playerId}:${w.statType}`));
  const watchedLines = activeLinesRaw.filter(l => l.playerId && watchKeys.has(`${l.playerId}:${l.statType}`));

  // ── Recent performance ────────────────────────────────────────────────────
  const wins     = recentEntries.filter(e => e.result === "win").length;
  const losses   = recentEntries.filter(e => e.result === "loss").length;
  const partials = recentEntries.filter(e => e.result === "partial").length;
  const pnl      = recentEntries.reduce((s, e) => {
    const stake  = Number(e.stake);
    const payout = Number(e.actualPayout ?? e.potentialPayout);
    if (e.result === "win"  || e.result === "partial") return s + payout - stake;
    if (e.result === "loss") return s - stake;
    return s;
  }, 0);
  const hitRate  = recentEntries.length > 0
    ? Math.round(((wins + partials) / recentEntries.length) * 1000) / 10 : 0;

  const calBuckets = Number(calStats[0]?.cnt ?? 0);

  // ── Assemble context ──────────────────────────────────────────────────────
  const blocks: string[] = [
    `=== PRIZEPICKS ANALYTICS WORKSTATION — ${today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ===`,
    "",
    "── HOW THIS MODEL WORKS ───────────────────────────────────────────────",
    "Statistical distributions (Poisson for counting stats, Negative Binomial for overdispersed",
    "counts like RBIs/assists, ZIP for zero-heavy stats like steals/blocks, Log-normal for yardage)",
    "feed a Bayesian shrinkage engine. Raw P(Over) is CALIBRATED against " + calBuckets + " empirical",
    "hit-rate buckets from historical game logs — not raw math guesses. Scoring grades 4",
    "components: Edge (model vs line gap), Stability (stdDev), Market Support (sportsbook",
    "alignment), Risk (injury/data quality). PLAY = finalScore≥70 & edgeScore≥55 & riskScore≤45.",
    "Min 5 games required for any PLAY. Trust calibrated P(Over) over gut feel.",
    "",
    "── TODAY'S GAME SCHEDULE ──────────────────────────────────────────────",
    ...(schedLines.length > 0 ? schedLines : ["  No games synced — run Settings → Sync Schedule."]),
    "",
    `── TODAY'S SLATE: ${activeLinesRaw.length} ACTIVE LINES ─────────────────────────────`,
    `   ${plays.length} PLAY  |  ${actions.length} ACTION  |  ${watches.length} WATCH  |  ${noPlay.length} NO-PLAY/GATED`,
    "",
    `▶ PLAY PROPS (${plays.length}) — all 5 gates passed; highest confidence picks:`,
    ...(plays.length > 0
      ? plays.map((l, i) => fmtLine(l, i + 1))
      : ["  None — run Sync Projections then Rescore Props."]),
    "",
    `▶ ACTION PROPS (${actions.length}) — strong signal; include in multi-leg entries:`,
    ...(actions.length > 0
      ? actions.slice(0, 20).map((l, i) => fmtLine(l, i + 1))
      : ["  None"]),
    "",
    `▶ WATCH PROPS (showing top 10 of ${watches.length}):`,
    ...watches.slice(0, 10).map(l => fmtLine(l)),
    ...(watches.length === 0 ? ["  None"] : []),
    "",
    `▶ GATED/NO-PLAY (${noPlay.length} blocked — reason shown):`,
    ...noPlay.slice(0, 5).map(l => fmtLine(l)),
    ...(noPlay.length === 0 ? ["  None"] : []),
    "",
    "── INJURY & STATUS REPORT ─────────────────────────────────────────────",
    ...(injLines.length > 0 ? injLines : ["  No recent reports."]),
    "",
    "── USER WATCHLIST ─────────────────────────────────────────────────────",
    ...(watchedLines.length > 0
      ? watchedLines.map(l => fmtLine(l))
      : ["  Nothing on watchlist."]),
    "",
    `── RECENT PERFORMANCE (last ${recentEntries.length} settled) ────────────────────────`,
    `  Record: ${wins}W / ${losses}L / ${partials} partial — Entry Hit Rate: ${hitRate}%`,
    `  P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
    "",
    `── PENDING ENTRIES (${pendingEntries.length}) ───────────────────────────────────────`,
    ...(pendingEntries.length > 0
      ? pendingEntries.map(e =>
          `  • ${e.pickCount}-pick ${e.entryType} — $${e.stake} → $${e.potentialPayout}${e.notes ? ` — "${e.notes}"` : ""}`)
      : ["  None"]),
  ];

  return blocks.join("\n");
}

router.get("/anthropic/conversations", async (req, res) => {
  try {
    const convs = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
    res.json(convs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/anthropic/conversations", async (req, res) => {
  try {
    const { title } = req.body as { title?: string };
    const [conversation] = await db.insert(conversations)
      .values({ title: title ?? "New conversation" })
      .returning();
    res.status(201).json(conversation);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/anthropic/conversations/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const msgs = await db.select().from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);
    res.json({ conversation, messages: msgs });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/anthropic/conversations/:id", async (req, res) => {
  try {
    await db.delete(messages).where(eq(messages.conversationId, Number(req.params.id)));
    await db.delete(conversations).where(eq(conversations.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/anthropic/conversations/:id/messages", async (req, res) => {
  try {
    const msgs = await db.select().from(messages)
      .where(eq(messages.conversationId, Number(req.params.id)))
      .orderBy(messages.createdAt);
    res.json(msgs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/anthropic/conversations/:id/messages", async (req, res): Promise<void> => {
  try {
    const conversationId = Number(req.params.id);
    const { content } = req.body as { content: string };

    const [conversation] = await db.select().from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const [userMsg] = await db.insert(messages)
      .values({ conversationId, role: "user", content })
      .returning();

    const history = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    const messageList = history.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const contextSnapshot = await buildAnalystContext();

    const systemPrompt = [
      "You are an expert sports analytics AI for a private PrizePicks analyst. You have full access to today's live slate including calibrated probability scores, prop scoring grades (PLAY/ACTION/WATCH/NO-PLAY), injury reports, game schedules, and the analyst's performance history — all provided below.",
      "",
      "Core behaviors:",
      "• When asked for picks: lead with PLAY props, then ACTION. Never recommend WATCH or NO-PLAY as primary picks.",
      "• Always state the recommended SIDE (Over/Under) — it's in the data as 'Side:OVER' or 'Side:UNDER'.",
      "• Cite actual P(Over)%, Edge score, and Games (sample size) when explaining confidence.",
      "• If a player is OUT or GTD in the injury report, flag it prominently — do not recommend them.",
      "• The ⚡SHARP tag means sharp money is confirming the model direction — significant signal.",
      "• ★BV means this tier (standard/goblin/demon) has the highest calibrated EV for that player.",
      "• Payout multipliers (exact — never guess): Power 2=3× | 3=6× | 4=10× | 5=20× | 6=40×",
      "• Break-even P per leg (Power): P2=57.7% | P3=55.0% | P4=56.2% | P5=55.5% | P6=56.8%",
      "• For MAX PROFIT / BEST EV queries: lead with ★BV standard-line PLAYs, not high-rate goblin lines.",
      "  Goblin lines boost hit rate but sacrifice payout. ★BV already accounts for P×multiplier math.",
      "  State combined entry EV = (P1×P2×…×Pn) × multiplier when making entry recommendations.",
      "• If PLAY count is 0, say so honestly and recommend ACTION props with appropriate caveats.",
      "• The model needs ≥5 games per player — 'N:?' or small N means less reliable.",
      "",
      contextSnapshot,
    ].join("\n");

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      system: systemPrompt,
      messages: messageList,
    });

    const assistantContent = response.content
      .filter(b => b.type === "text")
      .map(b => (b.type === "text" ? b.text : ""))
      .join("");

    const [assistantMsg] = await db.insert(messages)
      .values({ conversationId, role: "assistant", content: assistantContent })
      .returning();

    res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
