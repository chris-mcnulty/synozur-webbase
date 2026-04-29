import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { buildSystemPrompt } from "../lib/ai/grounding.js";

const router = Router();

const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  model: z.enum(ALLOWED_MODELS).optional().default("claude-sonnet-4-6"),
  scopeTags: z.array(z.string()).optional(),
  conciergeOnly: z.boolean().optional().default(false),
  conversationId: z.number().int().positive().optional(),
});

const CreateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional().default("New conversation"),
});

// POST /ai/conversations — start a new conversation
router.post("/ai/conversations", async (req, res) => {
  try {
    const body = CreateConversationSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [conv] = await db
      .insert(conversations)
      .values({ title: body.data.title })
      .returning();
    res.json(conv);
  } catch (err) {
    req.log.error({ err }, "Failed to create conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// GET /ai/conversations/:id/messages — retrieve history
router.get("/ai/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }
  try {
    const conv = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (conv.length === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);
    res.json({ conversation: conv[0], messages: msgs });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch messages");
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// POST /ai/chat — streaming Claude response (SSE)
//
// The client sends a single user message. If conversationId is omitted a new
// conversation is auto-created. The endpoint streams the assistant delta via
// SSE and saves both the user message and the final assistant message to the DB
// before closing the stream.
router.post("/ai/chat", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
    return;
  }
  const { message, model, scopeTags, conciergeOnly, conversationId } = parsed.data;

  let convId: number;
  try {
    if (conversationId) {
      const existing = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (existing.length === 0) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      convId = conversationId;
    } else {
      const [newConv] = await db
        .insert(conversations)
        .values({ title: message.slice(0, 80) })
        .returning();
      convId = newConv.id;
    }

    // Load prior messages for this conversation
    const priorMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(messages.createdAt);

    // Save the user message
    await db.insert(messages).values({
      conversationId: convId,
      role: "user",
      content: message,
    });

    // Build the grounding system prompt
    const systemPrompt = await buildSystemPrompt({ scopeTags, conciergeOnly });

    // Compose the full message array for the API
    const chatMessages = [
      ...priorMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    // Begin SSE stream
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Send conversation id so the client can reference it in follow-up calls
    res.write(`data: ${JSON.stringify({ conversationId: convId })}\n\n`);

    let fullResponse = "";

    const streamParams: Parameters<typeof anthropic.messages.stream>[0] = {
      model: model as AllowedModel,
      max_tokens: 8192,
      messages: chatMessages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
    };

    const stream = anthropic.messages.stream(streamParams);

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    // Persist the complete assistant response
    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true, conversationId: convId })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "AI chat request failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "AI chat request failed" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }
});

export default router;
