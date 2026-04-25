import { randomBytes, createHash } from "crypto";
import type { Request, Response } from "express";
import { eq, lt } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";
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
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;        // 8 hours of inactivity
const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30-day absolute cap
const ROLLING_RENEW_MS = 30 * 60 * 1000;          // bump lastSeenAt at most every 30 min

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
}): Promise<CreatedSession> {
  const token = newSessionToken();
  const id = hashSessionId(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({
    id,
    userId: args.userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    userAgent: args.userAgent,
    ip: args.ip,
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
  // Rolling renewal: extend the inactivity window without thrashing the row
  // on every request.
  if (now.getTime() - row.lastSeenAt.getTime() > ROLLING_RENEW_MS) {
    const newExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
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
