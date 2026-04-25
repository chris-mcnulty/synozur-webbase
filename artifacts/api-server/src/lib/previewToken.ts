import crypto from "node:crypto";
import { logger } from "./logger";

// #60: short-lived signed tokens that let admins view an unpublished
// service or solution on the public detail page. The token encodes
// `<kind>.<id>.<exp>` signed with HMAC-SHA256. Secret precedence:
// PREVIEW_TOKEN_SECRET (explicit opt-in) ➜ SESSION_SECRET ➜ a boot-time
// random secret (dev fallback only; tokens don't survive restart, which is
// fine since they expire in 24 h anyway).
const PROCESS_SECRET = crypto.randomBytes(32).toString("hex");

function resolveSecret(): string {
  return (
    process.env["PREVIEW_TOKEN_SECRET"] ||
    process.env["SESSION_SECRET"] ||
    PROCESS_SECRET
  );
}

export type PreviewKind = "service" | "solution";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", resolveSecret())
    .update(payload)
    .digest("base64url");
}

export function signPreviewToken(
  kind: PreviewKind,
  id: string,
  ttlMs: number = DEFAULT_TTL_MS,
): { token: string; expiresAt: Date } {
  const exp = Date.now() + ttlMs;
  const payload = `${kind}.${id}.${exp}`;
  const sig = sign(payload);
  return {
    token: `${Buffer.from(payload, "utf8").toString("base64url")}.${sig}`,
    expiresAt: new Date(exp),
  };
}

export function verifyPreviewToken(
  token: string | null | undefined,
  expectKind: PreviewKind,
  expectId: string,
): boolean {
  if (!token) return false;
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = sign(payload);
    // Constant-time comparison.
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const [kind, id, expStr] = payload.split(".");
    if (kind !== expectKind) return false;
    if (id !== expectId) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    return true;
  } catch (err) {
    logger.debug({ err }, "preview token verification threw");
    return false;
  }
}
