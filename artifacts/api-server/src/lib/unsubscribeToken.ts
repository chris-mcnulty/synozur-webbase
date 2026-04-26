import crypto from "node:crypto";
import { logger } from "./logger";

// Unsubscribe tokens are HMAC-signed and encode a comment ID plus the
// notification type ("approval" | "reply"). They are embedded in transactional
// emails so visitors can opt out with a single click.
//
// Design decision — no expiry: unlike session or preview tokens, unsubscribe
// links must remain valid indefinitely. A link pasted into a browser months
// after the email was received still needs to work. The only data the token
// unlocks is clearing a notification flag on a single comment row, so the
// risk of an indefinitely valid token is low.
//
// Secret precedence: SESSION_SECRET ➜ a boot-time random (dev fallback).
// In production SESSION_SECRET must be set (and stable across restarts) so
// that tokens survive server restarts. Using the same precedence chain as
// previewToken.ts keeps secrets consistent.

const PROCESS_SECRET = crypto.randomBytes(32).toString("hex");

function resolveSecret(): string {
  return process.env["SESSION_SECRET"] || PROCESS_SECRET;
}

export type UnsubscribeType = "approval" | "reply";

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", resolveSecret())
    .update(payload)
    .digest("base64url");
}

export function signUnsubscribeToken(commentId: string, type: UnsubscribeType): string {
  const payload = `${commentId}.${type}`;
  const sig = sign(payload);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

export interface UnsubscribePayload {
  commentId: string;
  type: UnsubscribeType;
}

export function verifyUnsubscribeToken(
  token: string | null | undefined,
): UnsubscribePayload | null {
  if (!token) return null;
  try {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx < 1) return null;
    const payloadB64 = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parts = payload.split(".");
    if (parts.length !== 2) return null;
    const [commentId, type] = parts;
    if (!commentId || (type !== "approval" && type !== "reply")) return null;
    return { commentId, type };
  } catch (err) {
    logger.debug({ err }, "unsubscribe token verification threw");
    return null;
  }
}
