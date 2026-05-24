import { Router } from "express";
import { db } from "@workspace/db";
import {
  conversations, messages,
  ourProjectionsTable, watchlistItemsTable, injuriesTable,
  entriesTable, playersTable, teamsTable, ppLinesTable,
  propScoresTable,
} from "@workspace/db/schema";
import { eq, desc, isNotNull, inArray, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

async function buildAnalystContext(): Promise<string> {
  const today = new Date();

  const [modelProjRows, watchRows, injuries, recentEntries, pendingEntriesRaw, activeLines, allTeams] =
    await Promise.all([
      db.select({
        playerId: ourProjectionsTable.playerId,
        statType: ourProjectionsTable.statType,
        pOver: ourProjectionsTable.pOver,
        noPlayReason: ourProjectionsTable.noPlayReason,
      })
        .from(ourProjectionsTable)
        .where(isNotNull(ourProjectionsTable.pOver))
        .orderBy(desc(ourProjectionsTable.pOver))
        .limit(12),

      db.select().from(watchlistItemsTable).limit(20),

      db.select().from(injuriesTable).orderBy(desc(injuriesTable.reportedAt)).limit(10),

      db.select().from(entriesTable)
        .where(inArray(entriesTable.result, ["win", "loss", "partial", "refund"]))
        .orderBy(desc(entriesTable.entryDate))
        .limit(30),

      db.select().from(entriesTable).where(eq(entriesTable.result, "pending")),

      db.select().from(ppLinesTable).where(eq(ppLinesTable.isActive, true)),

      db.select().from(teamsTable),
    ]);

  const projPlayerIds = modelProjRows.map(p => p.playerId).filter(Boolean) as number[];
  const watchPlayerIds = watchRows.map(w => w.playerId);
  const injuryPlayerIds = injuries.map(i => i.playerId);
  const allPlayerIds = [...new Set([...projPlayerIds, ...watchPlayerIds, ...injuryPlayerIds])];

  const [allPlayers, allScores] = await Promise.all([
    allPlayerIds.length
      ? db.select().from(playersTable).where(inArray(playersTable.id, allPlayerIds))
      : [],
    db.select().from(propScoresTable),
  ]);

  const playerMap = Object.fromEntries(allPlayers.map(p => [p.id, p]));
  const teamMap   = Object.fromEntries(allTeams.map(t => [t.id, t]));
  const lineMap   = new Map(activeLines.map(l => [`${l.playerId}:${l.statType}`, l]));
  const scoreMap  = Object.fromEntries(allScores.map(s => [s.ppLineId, s]));

  // Today's games lookup for opponent
  const gamesByTeam: Record<number, { homeTeamId: number; awayTeamId: number }> = {};
  // (we use line.teamId if available for matchup context)

  const topPickLines: string[] = [];
  for (const proj of modelProjRows) {
    if (!proj.playerId || !proj.pOver) continue;
    const player = playerMap[proj.playerId];
    if (!player) continue;
    const line = lineMap.get(`${proj.playerId}:${proj.statType}`);
    if (!line) continue;
    const score   = scoreMap[line.id];
    const teamAbbr = player.teamId ? (teamMap[player.teamId]?.abbreviation ?? "?") : "?";
    const pOverPct = Math.round(parseFloat(proj.pOver.toString()) * 10) / 10;
    const tag      = score?.actionTag ?? "UNRATED";
    const gated    = proj.noPlayReason ? ` [GATED: ${proj.noPlayReason}]` : "";
    const scoreReasoning = (score?.reasoning as Record<string, unknown> | null) ?? null;
    const mktEdge = scoreReasoning?.marketEdge != null ? ` — Mkt Edge: ${scoreReasoning.marketEdge}%` : "";
    const holdNote = scoreReasoning?.holdPct != null
      ? ` — Hold: ${(Number(scoreReasoning.holdPct) * 100).toFixed(1)}%`
      : "";
    topPickLines.push(`  ${topPickLines.length + 1}. ${player.fullName} (${teamAbbr}) — ${proj.statType} — Line: ${line.lineValue} — P(Over): ${pOverPct}%${mktEdge}${holdNote} — Tag: ${tag}${gated}`);
  }

  const watchLines: string[] = watchRows.map(w => {
    const player = playerMap[w.playerId];
    const line   = lineMap.get(`${w.playerId}:${w.statType}`);
    if (!player) return null;
    return `  • ${player.fullName} — ${w.statType}${line ? ` (Line: ${line.lineValue})` : ""}`;
  }).filter(Boolean) as string[];

  const injuryLines: string[] = injuries.map(i => {
    const player = playerMap[i.playerId];
    if (!player) return null;
    const team = player.teamId ? teamMap[player.teamId] : null;
    return `  • ${player.fullName} (${team?.abbreviation ?? "?"}) — ${i.status.toUpperCase()} — ${i.note ?? ""}`;
  }).filter(Boolean) as string[];

  const wins     = recentEntries.filter(e => e.result === "win").length;
  const losses   = recentEntries.filter(e => e.result === "loss").length;
  const partials = recentEntries.filter(e => e.result === "partial").length;
  const pnl      = recentEntries.reduce((sum, e) => {
    const stake  = Number(e.stake);
    const payout = Number(e.actualPayout ?? e.potentialPayout);
    if (e.result === "win" || e.result === "partial") return sum + payout - stake;
    if (e.result === "loss") return sum - stake;
    return sum;
  }, 0);
  const hitRate = recentEntries.length > 0
    ? Math.round(((wins + partials) / recentEntries.length) * 1000) / 10
    : 0;

  const pendingLines = pendingEntriesRaw.map(e =>
    `  • ${e.pickCount}-pick ${e.entryType} — $${e.stake} → $${e.potentialPayout}${e.notes ? ` — "${e.notes}"` : ""}`
  );

  const blocks = [
    `=== PRIZEPICKS ANALYST CONTEXT — ${today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ===`,
    "",
    `TOP MODEL PICKS TODAY (ranked by Bayesian P(Over), highest confidence first):`,
    ...(topPickLines.length > 0 ? topPickLines : ["  No projection data — sync needed."]),
    "",
    `WATCHLIST (${watchLines.length} props being tracked):`,
    ...(watchLines.length > 0 ? watchLines : ["  None"]),
    "",
    `ACTIVE INJURIES & STATUS:`,
    ...(injuryLines.length > 0 ? injuryLines : ["  None reported"]),
    "",
    `RECENT PERFORMANCE (last ${recentEntries.length} settled entries):`,
    `  Record: ${wins}W / ${losses}L / ${partials} partial — Entry Hit Rate: ${hitRate}%`,
    `  P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
    "",
    `PENDING ENTRIES (${pendingLines.length}):`,
    ...(pendingLines.length > 0 ? pendingLines : ["  None"]),
    "",
    `Use this data to answer questions precisely. Reference specific player names, lines, and P(Over) values when relevant. Be concise and direct.`,
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
      "You are an expert sports analytics AI for a private PrizePicks analyst. You have access to live model projections, line data, injury reports, watchlist, and the analyst's recent performance history — all provided below.",
      "Be direct, precise, and data-driven. Reference specific player names, lines, and P(Over) values from the context. When asked about a prop or player, look it up in the TOP MODEL PICKS section. When discussing risk, reference injuries and GTD/OUT status.",
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
