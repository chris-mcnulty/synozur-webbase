import { logger } from "./logger";

const TURNSTILE_SECRET = process.env["TURNSTILE_SECRET_KEY"] ?? "";

export function isTurnstileActive(): boolean {
  return TURNSTILE_SECRET.length > 0;
}

export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null,
): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams();
    body.set("secret", TURNSTILE_SECRET);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch (err) {
    logger.warn({ err }, "Turnstile verification failed");
    return false;
  }
}
