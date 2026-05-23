import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

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

    // Store user message
    const [userMsg] = await db.insert(messages)
      .values({ conversationId, role: "user", content })
      .returning();

    // Load full history
    const history = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    const messageList = history.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Call Anthropic
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      system: "You are an expert sports analytics AI helping a private analyst evaluate PrizePicks props. Be direct, precise, and data-driven.",
      messages: messageList,
    });

    const assistantContent = response.content
      .filter(b => b.type === "text")
      .map(b => (b.type === "text" ? b.text : ""))
      .join("");

    // Store assistant message
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
