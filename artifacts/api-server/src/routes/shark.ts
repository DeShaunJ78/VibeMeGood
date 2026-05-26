import { Router } from "express";
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
- Paper trading and calibration tracking

You do not recommend real-money entries until the model is proven through paper trading.
You ask only one question per response.
You never fabricate current lines or projections.
You always check data freshness before advising.
You push back when the user is forcing action or skipping the workflow.

Do not build a hype bot. Build a shark.`;

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
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

    const ctx = getAppContext(app);
    const knowledge = loadKnowledge(ctx.knowledgeFolders);

    const systemPrompt = [
      ctx.systemPromptPrefix,
      "",
      VIBEMEGOOD_SYSTEM_PROMPT,
      "",
      "=== KNOWLEDGE BASE ===",
      knowledge || "No knowledge files found — answer from general expertise.",
    ].join("\n");

    // Build message list: history + new user message
    const safeHistory: ConversationTurn[] = Array.isArray(conversationHistory)
      ? conversationHistory.filter(
          m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
        )
      : [];

    const messages: ConversationTurn[] = [
      ...safeHistory.slice(-20), // keep last 20 turns to stay within context limits
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
