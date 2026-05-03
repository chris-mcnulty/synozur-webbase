import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  db,
  conversations,
  messages,
  aiChatTokenUsageTable,
  type Conversation,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { buildSystemPrompt } from "../lib/ai/grounding.js";
import {
  applyHistoryCacheMarkers,
  buildCachedSystemBlocks,
  emptyCacheUsage,
  cacheHitRate,
  mergeMessageDeltaUsage,
  mergeMessageStartUsage,
  type CacheUsage,
} from "../lib/ai/promptCache.js";
import { audit } from "../lib/audit";
import { verifyTurnstile, isTurnstileActive } from "../lib/turnstile";
import {
  mintChatSession,
  getChatActor,
  clientIpKey,
  checkBudget,
  recordTokenUsage,
  pageOnCallGlobalCapBreach,
  stripRoleHeaders,
  clipPriorMessages,
  type ChatActor,
} from "../lib/aiChatSession";

const router: IRouter = Router();

const ALLOWED_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-haiku-4-5",
] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  model: z.enum(ALLOWED_MODELS).optional().default("claude-sonnet-4-6"),
  scopeTags: z.array(z.string()).optional(),
  conciergeOnly: z.boolean().optional().default(false),
  conversationId: z.string().uuid().optional(),
});

const CreateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional().default("New conversation"),
});

const StartSessionSchema = z.object({
  turnstileToken: z.string().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Rate limiters — per-IP and per-session, plus a 10s burst guard.
// 429s emit `audit.action='ai.chat.rate_limited'` so abusive callers are
// visible in the security log even before the budget cap kicks in.
// ---------------------------------------------------------------------------
function chatLimitHandler(scope: "ip" | "session" | "burst") {
  return (req: Request, res: Response): void => {
    const ip = ipKeyGenerator(req.ip ?? "");
    void audit({
      action: "ai.chat.rate_limited",
      entity: "ip",
      entityId: ip,
      diff: { scope },
    });
    res.setHeader("Retry-After", "60");
    res.status(429).json({
      error:
        scope === "burst"
          ? "Too many messages — please slow down."
          : "Too many AI chat messages from this " +
            (scope === "ip" ? "network" : "session") +
            ". Try again later.",
    });
  };
}

function sessionKey(req: Request): string {
  // Authenticated callers MUST be keyed by their stable user id — otherwise
  // a malicious user could rotate `aicid` cookies on every request and
  // entirely defeat the per-session limiter. Anonymous callers are keyed
  // by their cookie value (the limiter runs before getChatActor resolves
  // the session row, so we use the raw cookie); IP is the final fallback.
  const uid = req.authedUser?.id;
  if (uid) return `u:${uid}`;
  const raw = req.headers.cookie ?? "";
  const m = /aicid=([^;]+)/.exec(raw);
  if (m) return `s:${m[1]}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

const burstLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 3,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `aichat:burst:${sessionKey(req as Request)}`,
  handler: chatLimitHandler("burst"),
});

const sessionHourLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `aichat:sess:${sessionKey(req as Request)}`,
  handler: chatLimitHandler("session"),
});

const ipHourLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `aichat:ip:${ipKeyGenerator((req as Request).ip ?? "")}`,
  handler: chatLimitHandler("ip"),
});

const startSessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `aichat:start:${ipKeyGenerator((req as Request).ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many session-start attempts." });
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ownsConversation(conv: Conversation, actor: ChatActor): boolean {
  if (actor.userId && conv.ownerUserId === actor.userId) return true;
  if (actor.sessionId && conv.ownerSessionId === actor.sessionId) return true;
  return false;
}

async function loadConversation(id: string): Promise<Conversation | null> {
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// POST /ai/sessions/start — Turnstile-gated; mints an anonymous chat session
// cookie + row.
// ---------------------------------------------------------------------------
router.post("/ai/sessions/start", startSessionLimiter, async (req, res) => {
  const parsed = StartSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  // Turnstile is no-op when TURNSTILE_SECRET_KEY is unset (dev parity with
  // the existing comment-submit pattern). When it *is* configured we require
  // a token before minting the session, since this is the public-bot entry.
  if (isTurnstileActive()) {
    const ok = await verifyTurnstile(parsed.data.turnstileToken, clientIpKey(req));
    if (!ok) {
      void audit({ action: "ai.chat.turnstile_failed", entity: "ip", entityId: clientIpKey(req) });
      res.status(403).json({ error: "Verification failed" });
      return;
    }
  }
  try {
    const session = await mintChatSession(req, res);
    void audit({ action: "ai.chat.session_started", entity: "ai_chat_session", entityId: session.id });
    res.json({ ok: true, expiresAt: session.expiresAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "ai chat session mint failed");
    res.status(500).json({ error: "Failed to start chat session" });
  }
});

// ---------------------------------------------------------------------------
// POST /ai/conversations — start a new conversation (auth/session required)
// ---------------------------------------------------------------------------
router.post("/ai/conversations", async (req, res) => {
  const actor = await getChatActor(req);
  if (!actor) {
    res.status(401).json({ error: "Chat session required" });
    return;
  }
  const body = CreateConversationSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const [conv] = await db
      .insert(conversations)
      .values({
        title: body.data.title,
        ownerUserId: actor.userId,
        ownerSessionId: actor.sessionId,
      })
      .returning();
    res.json(conv);
  } catch (err) {
    req.log.error({ err }, "Failed to create conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// ---------------------------------------------------------------------------
// GET /ai/conversations/:id/messages — only the owner can read history
// ---------------------------------------------------------------------------
router.get("/ai/conversations/:id/messages", async (req, res) => {
  const actor = await getChatActor(req);
  if (!actor) {
    res.status(401).json({ error: "Chat session required" });
    return;
  }
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }
  try {
    const conv = await loadConversation(id);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!ownsConversation(conv, actor)) {
      void audit({
        action: "ai.chat.acl_denied",
        entity: "conversation",
        entityId: id,
        actorId: actor.userId,
      });
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);
    res.json({ conversation: conv, messages: msgs });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch messages");
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// ---------------------------------------------------------------------------
// POST /ai/chat — streaming Claude response (SSE), auth + ACL + budgeted +
// prompt-cached.
// ---------------------------------------------------------------------------
router.post(
  "/ai/chat",
  burstLimiter,
  sessionHourLimiter,
  ipHourLimiter,
  async (req, res) => {
    const actor = await getChatActor(req);
    if (!actor) {
      res.status(401).json({ error: "Chat session required" });
      return;
    }
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    const { message: rawMessage, model, scopeTags, conciergeOnly, conversationId } = parsed.data;
    const ipKey = clientIpKey(req);

    // Token budget — daily rollup vs site_settings caps. Block before any
    // upstream Anthropic call so the cost never lands.
    const verdict = await checkBudget(actor.scopeKey, ipKey);
    if (!verdict.ok) {
      void audit({
        action: "ai.chat.budget_exceeded",
        entity: actor.userId ? "user" : "ai_chat_session",
        entityId: actor.userId ?? actor.sessionId,
        diff: { reason: verdict.reason },
      });
      if (verdict.reason === "global") {
        pageOnCallGlobalCapBreach({ global: verdict.used, cap: verdict.cap });
      }
      res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
      res.status(429).json({
        error:
          verdict.reason === "global"
            ? "AI chat is temporarily unavailable due to capacity limits."
            : "Daily AI chat quota reached. Try again after midnight UTC.",
      });
      return;
    }

    // Prompt-injection guardrails.
    const { cleaned, triggered } = stripRoleHeaders(rawMessage);
    if (triggered) {
      void audit({
        action: "safety.suspected_injection",
        entity: actor.userId ? "user" : "ai_chat_session",
        entityId: actor.userId ?? actor.sessionId,
        diff: { kind: "role_header_strip" },
      });
    }
    const message = cleaned.trim();
    if (!message) {
      res.status(400).json({ error: "Message empty after sanitization" });
      return;
    }

    let convId: string;
    try {
      if (conversationId) {
        const existing = await loadConversation(conversationId);
        if (!existing) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }
        if (!ownsConversation(existing, actor)) {
          void audit({
            action: "ai.chat.acl_denied",
            entity: "conversation",
            entityId: conversationId,
            actorId: actor.userId,
          });
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        convId = conversationId;
      } else {
        const [newConv] = await db
          .insert(conversations)
          .values({
            title: message.slice(0, 80),
            ownerUserId: actor.userId,
            ownerSessionId: actor.sessionId,
          })
          .returning();
        convId = newConv.id;
      }

      // Load prior messages and clip to the safety window.
      const priorRaw = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convId))
        .orderBy(messages.createdAt);

      const priorForModel = priorRaw.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      const { kept, dropped } = clipPriorMessages(priorForModel);
      if (dropped > 0) {
        void audit({
          action: "ai.chat.history_clipped",
          entity: "conversation",
          entityId: convId,
          diff: { dropped },
        });
      }

      // Save the user message.
      await db.insert(messages).values({
        conversationId: convId,
        role: "user",
        content: message,
      });

      // Build the grounding system prompt and apply prompt-cache markers
      // (#167). The grounding-doc corpus changes only on edit, so within any
      // 5-minute window every turn for every concurrent visitor reuses the
      // cached system block. The last assistant message in history gets a
      // marker too, caching the entire prior conversation as a stable prefix
      // — only the new user message and the streamed assistant response are
      // billed as fresh input tokens.
      const systemPrompt = await buildSystemPrompt({ scopeTags, conciergeOnly });
      const systemBlocks = buildCachedSystemBlocks(systemPrompt);
      const chatMessages = applyHistoryCacheMarkers(kept, message);

      // Begin SSE stream
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ conversationId: convId })}\n\n`);

      let fullResponse = "";
      let usage: CacheUsage = emptyCacheUsage();

      const streamParams: Parameters<typeof anthropic.messages.stream>[0] = {
        model: model as AllowedModel,
        max_tokens: 8192,
        messages: chatMessages,
        ...(systemBlocks ? { system: systemBlocks } : {}),
      };

      const stream = anthropic.messages.stream(streamParams);

      for await (const event of stream) {
        if (event.type === "message_start") {
          usage = mergeMessageStartUsage(usage, event.message.usage);
        } else if (event.type === "message_delta") {
          usage = mergeMessageDeltaUsage(usage, event.usage);
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullResponse += event.delta.text;
          res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
        }
      }

      // Persist the assistant turn with token accounting.
      await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: fullResponse,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadInputTokens,
        cacheCreationTokens: usage.cacheCreationInputTokens,
      });

      // Daily budget rollup (#166) — fire-and-forget.
      void recordTokenUsage(actor.scopeKey, ipKey, {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadInputTokens,
        cacheCreation: usage.cacheCreationInputTokens,
      });

      // Prompt-cache hit-rate rollup (#167) — drives the Site Health
      // dashboard. Failure must NEVER break the chat response — the catch
      // swallows the error and logs it.
      const utcDay = new Date().toISOString().slice(0, 10);
      const isWarm = usage.cacheReadInputTokens > 0 ? 1 : 0;
      req.log.info(
        {
          event: "ai-chat.usage",
          conversationId: convId,
          model,
          utcDay,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheCreationInputTokens: usage.cacheCreationInputTokens,
          cacheReadInputTokens: usage.cacheReadInputTokens,
          cacheHitRate: cacheHitRate(usage),
          warm: isWarm === 1,
        },
        "ai-chat: usage rollup",
      );
      try {
        await db
          .insert(aiChatTokenUsageTable)
          .values({
            id: `${utcDay}:${model}`,
            utcDay,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            requestCount: 1,
            warmRequestCount: isWarm,
          })
          .onConflictDoUpdate({
            target: [aiChatTokenUsageTable.utcDay, aiChatTokenUsageTable.model],
            set: {
              inputTokens: sql`${aiChatTokenUsageTable.inputTokens} + ${usage.inputTokens}`,
              outputTokens: sql`${aiChatTokenUsageTable.outputTokens} + ${usage.outputTokens}`,
              cacheCreationInputTokens: sql`${aiChatTokenUsageTable.cacheCreationInputTokens} + ${usage.cacheCreationInputTokens}`,
              cacheReadInputTokens: sql`${aiChatTokenUsageTable.cacheReadInputTokens} + ${usage.cacheReadInputTokens}`,
              requestCount: sql`${aiChatTokenUsageTable.requestCount} + 1`,
              warmRequestCount: sql`${aiChatTokenUsageTable.warmRequestCount} + ${isWarm}`,
              lastSeenAt: sql`now()`,
            },
          });
      } catch (rollupErr) {
        req.log.warn(
          { err: rollupErr },
          "ai-chat: token-usage rollup write failed (chat response unaffected)",
        );
      }

      res.write(`data: ${JSON.stringify({ done: true, conversationId: convId, usage })}\n\n`);
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
  },
);

// `and` is imported for ACL extensions wired up in subsequent commits
// (combined ownership filters across user + session ownership).
void and;

export default router;
