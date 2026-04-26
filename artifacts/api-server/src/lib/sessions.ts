import { randomBytes, createHash } from "crypto";
import type { Request, Response } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, sessionsTable, siteSettingsTable } from "@workspace/db";
import { logger } from "./logger";

// Cookie-based session store backed by the `sessions` table.
//
// Cookie carries only the (high-entropy) session id; everything else lives in
// the row, so we can revoke any session unilaterally on sign-out, role change,
// or admin kick. The cookie name is intentionally generic (`sid`) so it
// doesn't leak the auth provider.
//
// We hash the session id at rest so a database leak doesn't yield usable
// session tokens — same pattern as a password hash.

const COOKIE_NAME = "sid";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;               // 8 hours of inactivity (default)
const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000;     // 30 days of inactivity (remember me)
const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;        // 30-day absolute cap
const ROLLING_RENEW_MS = 30 * 60 * 1000;                 // bump lastSeenAt at most every 30 min
const DEFAULT_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;      // 4 hours default

// Env-derived fallback for the idle timeout. Used when site_settings has no
// admin-set override. Parsed once at module load.
const ENV_IDLE_TIMEOUT_MS: number = (() => {
  const raw = process.env["IDLE_TIMEOUT_MS"];
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_IDLE_TIMEOUT_MS;
})();

// Small in-memory cache so resolveSession() doesn't issue an extra DB
// roundtrip on every authenticated request. The admin update endpoint calls
// invalidateIdleTimeoutCache() so changes take effect immediately; otherwise
// the cache refreshes naturally after IDLE_TIMEOUT_CACHE_TTL_MS.
const IDLE_TIMEOUT_CACHE_TTL_MS = 30 * 1000;
let cachedIdleTimeoutMs: number | null = null;
let cachedIdleTimeoutAt = 0;

function clampIdleTimeout(value: number): number {
  // Clamp to at least ROLLING_RENEW_MS so active users are never falsely
  // expired between lastSeenAt bumps. Returning early avoids a noisy log on
  // every cache miss when an admin has deliberately picked a small value.
  if (value < ROLLING_RENEW_MS) return ROLLING_RENEW_MS;
  return value;
}

export function invalidateIdleTimeoutCache(): void {
  cachedIdleTimeoutMs = null;
  cachedIdleTimeoutAt = 0;
}

async function getEffectiveIdleTimeoutMs(): Promise<number> {
  const now = Date.now();
  if (
    cachedIdleTimeoutMs !== null &&
    now - cachedIdleTimeoutAt < IDLE_TIMEOUT_CACHE_TTL_MS
  ) {
    return cachedIdleTimeoutMs;
  }
  let dbValue: number | null = null;
  try {
    const [row] = await db
      .select({ idleTimeoutMs: siteSettingsTable.idleTimeoutMs })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1))
      .limit(1);
    if (row && typeof row.idleTimeoutMs === "number" && row.idleTimeoutMs > 0) {
      dbValue = row.idleTimeoutMs;
    }
  } catch (err) {
    // If the settings row can't be loaded for any reason, fall through to the
    // env-derived value rather than locking everyone out.
    logger.warn({ err }, "failed to load idle timeout from site_settings; falling back to env default");
  }
  const effective = clampIdleTimeout(dbValue ?? ENV_IDLE_TIMEOUT_MS);
  cachedIdleTimeoutMs = effective;
  cachedIdleTimeoutAt = now;
  return effective;
}

function hashSessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function isSecureRequest(req: Request): boolean {
  if (process.env["NODE_ENV"] !== "production") return false;
  const proto = (req.headers["x-forwarded-proto"] ?? "").toString().toLowerCase();
  if (proto === "https") return true;
  return (req as Request & { secure?: boolean }).secure === true;
}

export function setSessionCookie(req: Request, res: Response, token: string, expiresAt: Date): void {
  const cookieParts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isSecureRequest(req)) cookieParts.push("Secure");
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const cookieParts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecureRequest(req)) cookieParts.push("Secure");
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

export function readSessionToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[COOKIE_NAME] === "string") {
    return cookies[COOKIE_NAME] as string;
  }
  // Fallback: parse Cookie header manually if cookie-parser isn't wired here.
  const header = req.headers["cookie"];
  if (!header) return null;
  for (const part of String(header).split(";")) {
    const [k, ...vparts] = part.trim().split("=");
    if (k === COOKIE_NAME) return decodeURIComponent(vparts.join("="));
  }
  return null;
}

export interface CreatedSession {
  token: string;
  rowId: string;
  expiresAt: Date;
}

export async function createSession(args: {
  userId: string;
  userAgent: string | null;
  ip: string | null;
  rememberMe?: boolean;
}): Promise<CreatedSession> {
  const token = newSessionToken();
  const id = hashSessionId(token);
  const now = new Date();
  const ttl = args.rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttl);
  await db.insert(sessionsTable).values({
    id,
    userId: args.userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    userAgent: args.userAgent,
    ip: args.ip,
    rememberMe: args.rememberMe ?? false,
  });
  return { token, rowId: id, expiresAt };
}

export interface ResolvedSession {
  id: string;
  userId: string;
  expiresAt: Date;
  // True iff the resolver bumped lastSeenAt + expiresAt on this request.
  // Callers should re-issue the cookie when this is set so the browser's
  // own expiry tracks the renewed server-side row.
  renewed: boolean;
}

export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const id = hashSessionId(token);
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1);
  if (!row) return null;
  const now = new Date();
  if (row.expiresAt.getTime() < now.getTime()) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
    return null;
  }
  // Absolute lifetime cap.
  if (now.getTime() - row.createdAt.getTime() > ABSOLUTE_TTL_MS) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
    return null;
  }
  // Idle timeout: expire sessions that have had no activity for the
  // admin-configured idle window (or env/default fallback), regardless of the
  // rolling expiresAt window. Resolved per-call (with a short cache) so
  // changing the value in Site Settings takes effect immediately.
  const idleTimeoutMs = await getEffectiveIdleTimeoutMs();
  if (now.getTime() - row.lastSeenAt.getTime() > idleTimeoutMs) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
    return null;
  }
  // Rolling renewal: extend the inactivity window without thrashing the row
  // on every request. Use the remember-me TTL if the session was created with it.
  if (now.getTime() - row.lastSeenAt.getTime() > ROLLING_RENEW_MS) {
    const renewTtl = row.rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;
    const newExpiresAt = new Date(now.getTime() + renewTtl);
    await db
      .update(sessionsTable)
      .set({ lastSeenAt: now, expiresAt: newExpiresAt })
      .where(eq(sessionsTable.id, id));
    return { id, userId: row.userId, expiresAt: newExpiresAt, renewed: true };
  }
  return { id, userId: row.userId, expiresAt: row.expiresAt, renewed: false };
}

export async function destroySession(token: string): Promise<void> {
  const id = hashSessionId(token);
  await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  rememberMe: boolean;
}

export async function listSessionsForUser(userId: string): Promise<SessionSummary[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.userId, userId), gt(sessionsTable.expiresAt, now)));
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    expiresAt: r.expiresAt,
    rememberMe: r.rememberMe ?? false,
  }));
}

export async function destroySessionById(id: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
}

// Periodic GC. The api-server tick only needs this once an hour because the
// resolver short-circuits on expired rows already.
export async function pruneExpiredSessions(): Promise<{ deleted: number }> {
  try {
    const result = await db
      .delete(sessionsTable)
      .where(lt(sessionsTable.expiresAt, new Date()))
      .returning({ id: sessionsTable.id });
    return { deleted: result.length };
  } catch (err) {
    logger.warn({ err }, "session pruner failed");
    return { deleted: 0 };
  }
}
