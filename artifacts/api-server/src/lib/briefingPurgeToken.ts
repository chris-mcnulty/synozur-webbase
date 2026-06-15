import crypto from "node:crypto";
import { logger } from "./logger";

// Signed token embedded in the "purge this MP3 from the server" link of a
// delivered briefing-podcast email. Encodes the briefing_podcasts row id.
//
// Mirrors unsubscribeToken.ts: HMAC-SHA256 over the payload, base64url
// encoded, no expiry (the link should keep working whenever the recipient
// gets around to clicking it — all it does is delete a single MP3 from SPE
// and flip the row to `purged`).
//
// Secret precedence: SESSION_SECRET ➜ boot-time random (dev fallback). In
// production SESSION_SECRET must be set and stable so tokens survive
// restarts.

const PROCESS_SECRET = crypto.randomBytes(32).toString("hex");

function resolveSecret(): string {
  return process.env["SESSION_SECRET"] || PROCESS_SECRET;
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", resolveSecret())
    .update(payload)
    .digest("base64url");
}

export function signBriefingPurgeToken(podcastId: string): string {
  const payload = `briefing-purge.${podcastId}`;
  const sig = sign(payload);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`;
}

export function verifyBriefingPurgeToken(
  token: string | null | undefined,
): { podcastId: string } | null {
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
    if (parts.length !== 2 || parts[0] !== "briefing-purge") return null;
    const podcastId = parts[1];
    if (!podcastId) return null;
    return { podcastId };
  } catch (err) {
    logger.debug({ err }, "briefing purge token verification threw");
    return null;
  }
}
