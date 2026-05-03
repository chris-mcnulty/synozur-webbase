import { randomBytes, createHash } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  aiChatSessions,
  aiChatTokenUsage,
  siteSettingsTable,
} from "@workspace/db";
import { ipKeyGenerator } from "express-rate-limit";
import { logger } from "./logger";

// Cookie carrying the opaque chat-session token. The token itself is
// cryptographically random (32 bytes base64url), and only its SHA-256 is
// persisted — same shape as the user `sessions` table. We deliberately use
// a separate cookie name from `sid` so the chat session can outlive a
// signed-out browser without leaking authentication state.
const COOKIE_NAME = "aicid";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Hard-coded defaults for the per-day caps. Admin overrides in
// `site_settings.ai_chat_daily_token_cap_*` win when set.
export const DEFAULT_PER_SCOPE_DAILY_CAP = 50_000;
export const DEFAULT_GLOBAL_DAILY_CAP = 5_000_000;

export interface ChatActor {
  // Exactly one of these is set.
  userId: string | null;
  sessionId: string | null;
  // Stable rate-limit + budget key for this caller. For authenticated users
  // it's `u:<uuid>`; for anonymous chat sessions it's the chat session id.
  scopeKey: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isSecureRequest(req: Request): boolean {
  if (process.env["NODE_ENV"] !== "production") return false;
  const proto = (req.headers["x-forwarded-proto"] ?? "").toString().toLowerCase();
  if (proto === "https") return true;
  return (req as Request & { secure?: boolean }).secure === true;
}

function setChatSessionCookie(req: Request, res: Response, token: string, expiresAt: Date): void {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function readChatSessionCookie(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[COOKIE_NAME] === "string") return cookies[COOKIE_NAME];
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === COOKIE_NAME && v) return decodeURIComponent(v);
  }
  return null;
}

export function clientIpKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? "0.0.0.0");
}

export async function mintChatSession(
  req: Request,
  res: Response,
): Promise<{ id: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const [row] = await db
    .insert(aiChatSessions)
    .values({
      tokenHash,
      ipAtCreation: clientIpKey(req),
      userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
      expiresAt,
    })
    .returning({ id: aiChatSessions.id });
  setChatSessionCookie(req, res, token, expiresAt);
  return { id: row.id, expiresAt };
}

export async function resolveChatSession(req: Request): Promise<{ id: string } | null> {
  const token = readChatSessionCookie(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ id: aiChatSessions.id })
    .from(aiChatSessions)
    .where(
      and(
        eq(aiChatSessions.tokenHash, tokenHash),
        gt(aiChatSessions.expiresAt, new Date()),
        isNull(aiChatSessions.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Best-effort lastSeenAt bump; never block the request on this.
  void db
    .update(aiChatSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(aiChatSessions.id, row.id))
    .catch((err) => logger.warn({ err }, "ai chat session lastSeenAt bump failed"));
  return { id: row.id };
}

export async function getChatActor(req: Request): Promise<ChatActor | null> {
  const userId = req.authedUser?.id ?? null;
  if (userId) {
    return { userId, sessionId: null, scopeKey: `u:${userId}` };
  }
  const session = await resolveChatSession(req);
  if (!session) return null;
  return { userId: null, sessionId: session.id, scopeKey: session.id };
}

interface BudgetCaps {
  perScope: number;
  global: number;
}

let cachedCaps: { caps: BudgetCaps; at: number } | null = null;
const CAPS_TTL_MS = 30_000;

async function loadCaps(): Promise<BudgetCaps> {
  const now = Date.now();
  if (cachedCaps && now - cachedCaps.at < CAPS_TTL_MS) return cachedCaps.caps;
  let perScope = DEFAULT_PER_SCOPE_DAILY_CAP;
  let global = DEFAULT_GLOBAL_DAILY_CAP;
  try {
    const [row] = await db
      .select({
        perSession: siteSettingsTable.aiChatDailyTokenCapPerSession,
        global: siteSettingsTable.aiChatDailyTokenCapGlobal,
      })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1))
      .limit(1);
    if (row?.perSession && row.perSession > 0) perScope = row.perSession;
    if (row?.global && row.global > 0) global = row.global;
  } catch (err) {
    logger.warn({ err }, "ai chat budget caps lookup failed; using defaults");
  }
  const caps = { perScope, global };
  cachedCaps = { caps, at: now };
  return caps;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

interface BudgetState {
  perScope: number;
  perIp: number;
  global: number;
  caps: BudgetCaps;
}

async function readBudget(scopeKey: string, ipKey: string): Promise<BudgetState> {
  const day = todayUtc();
  const caps = await loadCaps();
  const rows = await db
    .select({
      scopeType: aiChatTokenUsage.scopeType,
      scopeId: aiChatTokenUsage.scopeId,
      input: aiChatTokenUsage.inputTokens,
      output: aiChatTokenUsage.outputTokens,
    })
    .from(aiChatTokenUsage)
    .where(eq(aiChatTokenUsage.day, day));
  let perScope = 0;
  let perIp = 0;
  let global = 0;
  for (const r of rows) {
    const total = r.input + r.output;
    if (r.scopeType === "session" && r.scopeId === scopeKey) perScope += total;
    else if (r.scopeType === "ip" && r.scopeId === ipKey) perIp += total;
    else if (r.scopeType === "global") global += total;
  }
  return { perScope, perIp, global, caps };
}

export type BudgetVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: "session" | "ip" | "global";
      retryAfterSeconds: number;
      used: number;
      cap: number;
    };

function secondsUntilMidnightUtc(): number {
  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return Math.max(1, Math.floor((tomorrow.getTime() - now.getTime()) / 1000));
}

// Note: this is a preflight check, not an atomic reservation. Concurrent
// requests can each pass the check before any of their rollups land, so the
// cap is "soft" — a burst can briefly overshoot by ~(in-flight calls ×
// per-call tokens). The 3-req/10s burst limiter on the route caps the
// blast radius. If strict reservation semantics are ever required, move
// to an `INSERT … ON CONFLICT DO UPDATE … RETURNING` reservation row
// before the upstream call and reconcile actual usage afterwards.
export async function checkBudget(
  scopeKey: string,
  ipKey: string,
): Promise<BudgetVerdict> {
  const state = await readBudget(scopeKey, ipKey);
  const retry = secondsUntilMidnightUtc();
  if (state.global >= state.caps.global) {
    return {
      ok: false,
      reason: "global",
      retryAfterSeconds: retry,
      used: state.global,
      cap: state.caps.global,
    };
  }
  if (state.perScope >= state.caps.perScope) {
    return {
      ok: false,
      reason: "session",
      retryAfterSeconds: retry,
      used: state.perScope,
      cap: state.caps.perScope,
    };
  }
  if (state.perIp >= state.caps.perScope) {
    return {
      ok: false,
      reason: "ip",
      retryAfterSeconds: retry,
      used: state.perIp,
      cap: state.caps.perScope,
    };
  }
  return { ok: true };
}

// Read-only summary of today's + last N days of token spend, plus the
// active caps. Powers the admin /cms/site-health panel.
export async function summariseTokenUsage(daysWindow: number): Promise<{
  caps: BudgetCaps;
  today: { inputTokens: number; outputTokens: number; callCount: number };
  days: Array<{
    day: string;
    inputTokens: number;
    outputTokens: number;
    callCount: number;
  }>;
}> {
  const caps = await loadCaps();
  const since = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .select({
      day: aiChatTokenUsage.day,
      input: aiChatTokenUsage.inputTokens,
      output: aiChatTokenUsage.outputTokens,
      calls: aiChatTokenUsage.callCount,
    })
    .from(aiChatTokenUsage)
    .where(
      and(
        eq(aiChatTokenUsage.scopeType, "global"),
        sql`${aiChatTokenUsage.day} >= ${since}::date`,
      ),
    );
  const byDay = new Map<
    string,
    { inputTokens: number; outputTokens: number; callCount: number }
  >();
  for (const r of rows) {
    const key = typeof r.day === "string" ? r.day : String(r.day);
    byDay.set(key, {
      inputTokens: r.input,
      outputTokens: r.output,
      callCount: r.calls,
    });
  }
  const today = todayUtc();
  const todayRow = byDay.get(today) ?? { inputTokens: 0, outputTokens: 0, callCount: 0 };
  const days = Array.from(byDay.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return { caps, today: todayRow, days };
}

export interface TokenUsageDelta {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

async function bumpRollupRow(
  scopeType: string,
  scopeId: string,
  delta: TokenUsageDelta,
): Promise<void> {
  const day = todayUtc();
  await db
    .insert(aiChatTokenUsage)
    .values({
      day,
      scopeType,
      scopeId,
      inputTokens: delta.input,
      outputTokens: delta.output,
      cacheReadTokens: delta.cacheRead,
      cacheCreationTokens: delta.cacheCreation,
      callCount: 1,
    })
    .onConflictDoUpdate({
      target: [aiChatTokenUsage.day, aiChatTokenUsage.scopeType, aiChatTokenUsage.scopeId],
      set: {
        inputTokens: sql`${aiChatTokenUsage.inputTokens} + ${delta.input}`,
        outputTokens: sql`${aiChatTokenUsage.outputTokens} + ${delta.output}`,
        cacheReadTokens: sql`${aiChatTokenUsage.cacheReadTokens} + ${delta.cacheRead}`,
        cacheCreationTokens: sql`${aiChatTokenUsage.cacheCreationTokens} + ${delta.cacheCreation}`,
        callCount: sql`${aiChatTokenUsage.callCount} + 1`,
        updatedAt: new Date(),
      },
    });
}

export async function recordTokenUsage(
  scopeKey: string,
  ipKey: string,
  delta: TokenUsageDelta,
): Promise<void> {
  try {
    await Promise.all([
      bumpRollupRow("session", scopeKey, delta),
      bumpRollupRow("ip", ipKey, delta),
      bumpRollupRow("global", "global", delta),
    ]);
  } catch (err) {
    // Token rollup failure should never break the streaming response — the
    // user already paid the cost and the audit trail will pick up next call.
    logger.error({ err, scopeKey }, "ai chat token rollup write failed");
  }
}

export function pageOnCallGlobalCapBreach(state: { global: number; cap: number }): void {
  // Hook for the on-call pager. Today this is a structured log line that
  // the alerting pipeline can match on; #166 follow-up wires this to
  // PagerDuty when the routing key is provisioned.
  logger.error(
    { aiChatGlobalCapBreach: true, used: state.global, cap: state.cap },
    "ai chat global daily token cap breached — paging on-call",
  );
}

// --- Prompt-injection guardrails ---------------------------------------

// Strip leading "system:" / "assistant:" / "user:" role markers (and the
// common `### System` / `<|system|>` styles) from the start of the user's
// message and from each line, so an injected role header can't escape the
// user role we send to Claude.
const ROLE_HEADER_RE =
  /^[\s>*#\-_=]*(?:<\|?\s*)?(?:system|assistant|user|developer|tool)\s*[:>|\]]+\s*/gim;

export function stripRoleHeaders(input: string): {
  cleaned: string;
  triggered: boolean;
} {
  const cleaned = input.replace(ROLE_HEADER_RE, "");
  return { cleaned, triggered: cleaned !== input };
}

export const PRIOR_MESSAGE_TURN_LIMIT = 20;
export const PRIOR_MESSAGE_TOKEN_LIMIT = 50_000;

// Approximate token count from a string. ~4 chars / token is the standard
// heuristic for English; we deliberately overestimate slightly (3.5) so the
// guardrail trims aggressively rather than letting a long history blow the
// 50k window.
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function clipPriorMessages<T extends { role: string; content: string }>(
  prior: readonly T[],
): { kept: T[]; dropped: number } {
  // First clip by turn count (oldest dropped).
  const tail = prior.slice(-PRIOR_MESSAGE_TURN_LIMIT);
  // Then clip by approximate token budget — drop oldest until we fit.
  let total = tail.reduce((sum, m) => sum + approxTokens(m.content), 0);
  let start = 0;
  while (total > PRIOR_MESSAGE_TOKEN_LIMIT && start < tail.length) {
    total -= approxTokens(tail[start]!.content);
    start++;
  }
  const kept = tail.slice(start);
  return { kept, dropped: prior.length - kept.length };
}
