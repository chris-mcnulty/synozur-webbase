import crypto from "node:crypto";
import { logger } from "./logger";

// #259 — DOI confirmation tokens for newsletter subscribers.
//
// Mirrors the HMAC pattern in `unsubscribeToken.ts`, but unlike unsubscribe
// links these tokens carry a 7-day TTL (encoded as `iat` seconds-since-epoch
// in the signed payload) so a leaked confirmation link cannot be used months
// later to silently activate an address. The DB additionally stores the SHA-256
// hash of the raw token so confirmation also requires the row's hash to match
// — i.e. tokens revoked by a re-submission can no longer be confirmed even if
// the signature still verifies.

const TTL_SECONDS = 7 * 24 * 60 * 60;
const PROCESS_SECRET = crypto.randomBytes(32).toString("hex");

function resolveSecret(): string {
  return process.env["SESSION_SECRET"] || PROCESS_SECRET;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", resolveSecret()).update(payload).digest("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function signSubscriberConfirmToken(subscriberId: number): {
  token: string;
  hash: string;
} {
  const iat = Math.floor(Date.now() / 1000);
  const payload = `${subscriberId}.${iat}`;
  const sig = sign(payload);
  const token = `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
  return { token, hash: hashToken(token) };
}

export interface SubscriberConfirmPayload {
  subscriberId: number;
  issuedAt: number;
}

export function verifySubscriberConfirmToken(
  token: string | null | undefined,
): SubscriberConfirmPayload | null {
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
    const subscriberId = Number.parseInt(parts[0]!, 10);
    const issuedAt = Number.parseInt(parts[1]!, 10);
    if (!Number.isFinite(subscriberId) || subscriberId <= 0) return null;
    if (!Number.isFinite(issuedAt) || issuedAt <= 0) return null;
    const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
    if (ageSeconds > TTL_SECONDS) return null;
    return { subscriberId, issuedAt };
  } catch (err) {
    logger.debug({ err }, "subscriber confirm token verification threw");
    return null;
  }
}

export const SUBSCRIBER_CONFIRM_TTL_SECONDS = TTL_SECONDS;

// #259 — One-click unsubscribe tokens. Unlike confirmation tokens these have
// no expiry: an unsubscribe link pasted into a browser months after the email
// was received still needs to work (same trade-off as `unsubscribeToken.ts`).
// The token only unlocks setting status='unsubscribed' on a single
// subscribers row, so an indefinitely valid token is acceptable. We sign on
// `subscriberId` (a stable serial id) rather than email so rotating an email
// address invalidates outstanding unsubscribe links automatically.
export function signSubscriberUnsubscribeToken(subscriberId: number): string {
  const payload = `u.${subscriberId}`;
  const sig = sign(payload);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

export function verifySubscriberUnsubscribeToken(
  token: string | null | undefined,
): { subscriberId: number } | null {
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
    if (!payload.startsWith("u.")) return null;
    const subscriberId = Number.parseInt(payload.slice(2), 10);
    if (!Number.isFinite(subscriberId) || subscriberId <= 0) return null;
    return { subscriberId };
  } catch (err) {
    logger.debug({ err }, "subscriber unsubscribe token verification threw");
    return null;
  }
}
