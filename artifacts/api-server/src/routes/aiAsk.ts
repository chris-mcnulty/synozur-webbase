import { Router, type IRouter } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { desc, eq, gte, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, insightsQuestionsTable, type AskSource } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { buildSystemPrompt } from "../lib/ai/grounding";
import {
  searchEditorialCorpus,
  LOW_CONFIDENCE_SCORE,
  type CorpusHit,
} from "../lib/ai/searchEditorialCorpus";
import { reindexEditorialCorpus } from "../lib/ai/editorialIndex";
import { requireAuth, requireCapability } from "../middlewares/auth";

// Public Ask Synozur surface (#262). Implements an FTS-backed RAG flow:
// retrieve top chunks → compose a system prompt that combines admin
// grounding docs with the retrieved passages → stream Claude's reply
// over SSE → log the full Q+A row to insights_questions for telemetry.
//
// Phase-0 deviation: vector search is not yet wired (see #170). The
// retrieval is FTS-only; the vector leg will plug into the same shape
// once an embeddings provider is available.

const router: IRouter = Router();

const ALLOWED_MODELS = [
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-7",
] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];
const DEFAULT_MODEL: AllowedModel = "claude-haiku-4-5";

const HistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
// Up to 6 prior turns (3 Q+A pairs) — enough for a meaningful follow-up
// without ballooning the context or letting clients smuggle in arbitrary
// long histories on a public endpoint.
const AskRequestSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  model: z.enum(ALLOWED_MODELS).optional(),
  sessionId: z.string().min(1).max(100).optional(),
  history: z.array(HistoryTurnSchema).max(6).optional(),
});

function ipKey(req: import("express").Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  return ipKeyGenerator(xff || req.ip || "0.0.0.0");
}

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `ask:m:${ipKey(req)}`,
});
const askDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 60,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `ask:d:${ipKey(req)}`,
});

// Strip common PII patterns before persisting question/answer text. This is
// intentionally conservative — we accept some false positives (a token that
// looks like a phone number gets redacted) in exchange for not storing raw
// emails/phones/SSNs/credit cards/long ID strings entered by anonymous
// visitors. The model still sees the original question; only the telemetry
// row is redacted.
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[redacted-email]"],
  [/\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[redacted-phone]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[redacted-card]"],
  [/\b(?:sk|pk|rk|api|key|token|bearer)[_-][A-Za-z0-9_-]{16,}\b/gi, "[redacted-secret]"],
];

export function redactPII(input: string): string {
  let out = input;
  for (const [re, replacement] of PII_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

function hashIp(req: import("express").Request): string {
  const ip = ipKey(req);
  return crypto
    .createHash("sha256")
    .update(`${process.env["IP_HASH_SALT"] ?? "ask-synozur"}|${ip}`)
    .digest("hex")
    .slice(0, 32);
}

function buildContextBlock(hits: CorpusHit[]): string {
  if (hits.length === 0) return "";
  const sections = hits.map((h, i) => {
    const tag = `[${i + 1}]`;
    return `${tag} ${h.title} (${h.url})\n${h.text}`;
  });
  return [
    "### Retrieved editorial passages",
    "Cite passages using the bracketed numbers (e.g. [1], [2]). If the passages do not contain the answer, say so explicitly and offer to connect the visitor with a human.",
    sections.join("\n\n"),
  ].join("\n\n");
}

const REFUSAL_TEXT =
  "We don't have published material on that — talk to a human? You can reach the team through our [contact page](/contact).";

// ---------------------------------------------------------------------------
// POST /api/ai/ask — public, streaming
// ---------------------------------------------------------------------------

router.post("/ai/ask", askLimiter, askDailyLimiter, async (req, res) => {
  const parsed = AskRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  const {
    question,
    model = DEFAULT_MODEL,
    sessionId,
    history = [],
  } = parsed.data;

  let hits: CorpusHit[] = [];
  try {
    hits = await searchEditorialCorpus({ query: question, limit: 6 });
  } catch (err) {
    req.log?.warn({ err }, "Corpus search failed; continuing without retrieval");
  }

  // Map to the AskSource[] shape persisted in the questions log + sent to UI.
  const sources: AskSource[] = hits.map((h) => ({
    kind: h.kind,
    id: h.sourceId,
    title: h.title,
    url: h.url,
    score: h.score,
  }));
  const topScore = hits[0]?.score ?? 0;
  const lowConfidence = topScore < LOW_CONFIDENCE_SCORE;
  const refused = hits.length === 0;

  // SSE setup
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Always send sources first so the UI can render citation cards even if
  // generation fails partway through.
  res.write(`data: ${JSON.stringify({ sources })}\n\n`);

  // No corpus hits → return the refusal verbatim, log, exit. We don't burn a
  // model call when we have nothing to ground on. The UI keys off the
  // `refused` flag in the meta frame to render a real "talk to a human"
  // CTA — the markdown in REFUSAL_TEXT is a fallback for non-SSE clients.
  if (refused) {
    res.write(`data: ${JSON.stringify({ content: REFUSAL_TEXT })}\n\n`);
    const [inserted] = await db
      .insert(insightsQuestionsTable)
      .values({
        question: redactPII(question),
        answer: REFUSAL_TEXT,
        sources,
        model,
        refused: true,
        lowConfidence: true,
        sourceCount: 0,
        topScore: 0,
        sessionId: sessionId ?? null,
        ipHash: hashIp(req),
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500) ?? null,
      })
      .returning({ id: insightsQuestionsTable.id });
    res.write(
      `data: ${JSON.stringify({
        meta: {
          questionId: inserted?.id ?? null,
          refused: true,
          lowConfidence: true,
        },
      })}\n\n`,
    );
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  let fullResponse = "";
  try {
    const groundingPrompt = await buildSystemPrompt({});
    const contextBlock = buildContextBlock(hits);
    const systemPrompt = [groundingPrompt, contextBlock]
      .filter(Boolean)
      .join("\n\n");

    // Stitch any prior session turns ahead of the new question so the
    // model can resolve follow-ups like "and what about for SMB?"
    const messages = [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: question },
    ];
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }
  } catch (err) {
    req.log?.error({ err }, "Ask Synozur generation failed");
    if (!fullResponse) {
      const fallback =
        "Sorry — I couldn't generate an answer right now. Please try again in a moment.";
      res.write(`data: ${JSON.stringify({ content: fallback })}\n\n`);
      fullResponse = fallback;
    }
  }

  // Persist telemetry (PII-redacted: only ip-hash + truncated UA) and emit
  // the questionId so the UI can call /ai/ask/click on source taps.
  let questionId: string | null = null;
  try {
    const [inserted] = await db
      .insert(insightsQuestionsTable)
      .values({
        question: redactPII(question),
        answer: redactPII(fullResponse),
        sources,
        model,
        refused: false,
        lowConfidence,
        sourceCount: sources.length,
        topScore: Math.round(topScore * 100),
        sessionId: sessionId ?? null,
        ipHash: hashIp(req),
        userAgent: req.headers["user-agent"]?.toString().slice(0, 500) ?? null,
      })
      .returning({ id: insightsQuestionsTable.id });
    questionId = inserted?.id ?? null;
  } catch (err) {
    req.log?.warn({ err }, "Failed to persist insights question telemetry");
  }

  res.write(
    `data: ${JSON.stringify({
      meta: { questionId, refused: false, lowConfidence },
    })}\n\n`,
  );
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

// ---------------------------------------------------------------------------
// Click-through tracker (public). The Ask page calls this when a user
// clicks a source card so admins can see which citations actually drive
// follow-up reads.
// ---------------------------------------------------------------------------
router.post("/ai/ask/click", async (req, res) => {
  const id = z.string().uuid().safeParse(req.body?.questionId);
  if (!id.success) {
    res.status(400).json({ error: "Invalid questionId" });
    return;
  }
  await db
    .update(insightsQuestionsTable)
    .set({
      clickThroughCount: sql`${insightsQuestionsTable.clickThroughCount} + 1`,
    })
    .where(eq(insightsQuestionsTable.id, id.data));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin: question telemetry. Gated on content.moderate (editorial review)
// rather than ai.grounding.manage, since editors are the primary audience.
// ---------------------------------------------------------------------------
const adminGuard = [requireAuth, requireCapability("content.moderate")];

router.get("/cms/insights/questions", ...adminGuard, async (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
  const sinceDays = Math.max(1, Number(req.query["sinceDays"] ?? 30));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(insightsQuestionsTable)
    .where(gte(insightsQuestionsTable.createdAt, since))
    .orderBy(desc(insightsQuestionsTable.createdAt))
    .limit(limit);
  res.json({ items: rows });
});

router.get("/cms/insights/questions/summary", ...adminGuard, async (req, res) => {
  const sinceDays = Math.max(1, Number(req.query["sinceDays"] ?? 30));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  // Aggregate counts in SQL — cheap and avoids hauling rows into JS.
  const aggResult = await db.execute<{
    total: number;
    refused: number;
    low_confidence: number;
    click_throughs: number;
  }>(sql`
    SELECT
      COUNT(*)::int                                          AS total,
      COUNT(*) FILTER (WHERE refused)::int                   AS refused,
      COUNT(*) FILTER (WHERE low_confidence AND NOT refused)::int AS low_confidence,
      COALESCE(SUM(click_through_count), 0)::int             AS click_throughs
    FROM insights_questions
    WHERE created_at >= ${since}
  `);
  const aggRows = (
    Array.isArray(aggResult)
      ? aggResult
      : (aggResult as { rows?: unknown[] }).rows ?? []
  ) as Array<{
    total: number;
    refused: number;
    low_confidence: number;
    click_throughs: number;
  }>;
  const agg = aggRows[0] ?? {
    total: 0,
    refused: 0,
    low_confidence: 0,
    click_throughs: 0,
  };

  const topResult = await db.execute<{ question: string; n: number }>(sql`
    SELECT lower(question) AS question, COUNT(*)::int AS n
    FROM insights_questions
    WHERE created_at >= ${since}
    GROUP BY lower(question)
    ORDER BY n DESC
    LIMIT 20
  `);
  const topRows = (
    Array.isArray(topResult)
      ? topResult
      : (topResult as { rows?: unknown[] }).rows ?? []
  ) as Array<{ question: string; n: number }>;
  const top = topRows.map((r) => ({ question: r.question, count: r.n }));

  res.json({ since: since.toISOString(), agg, top });
});

// ---------------------------------------------------------------------------
// Admin trigger: rebuild the editorial corpus index. Gated on the
// grounding-manage capability so the same role that authors grounding
// docs can also refresh chunked retrieval after publishing.
// ---------------------------------------------------------------------------
router.post(
  "/ai/editorial-index/rebuild",
  requireAuth,
  requireCapability("ai.grounding.manage"),
  async (_req, res) => {
    const result = await reindexEditorialCorpus();
    res.json({ ok: true, ...result });
  },
);

export default router;
