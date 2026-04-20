import { Router, type IRouter, type Request } from "express";
import {
  SubmitContactBody,
  SubmitSubscribeBody,
  SubmitStartBody,
  SubmitContactResponse,
} from "@workspace/api-zod";
import { db, formSubmissionsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const WEBHOOK_URL = process.env["FORMS_WEBHOOK_URL"] ?? "";
const TURNSTILE_SECRET = process.env["TURNSTILE_SECRET_KEY"] ?? "";

function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}

function userAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 1000) : null;
}

async function verifyTurnstile(token: string | null | undefined, ip: string | null): Promise<boolean> {
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

interface ForwardResult {
  status: string;
  error: string | null;
}

async function forwardToWebhook(payload: unknown): Promise<ForwardResult> {
  if (!WEBHOOK_URL) return { status: "skipped", error: null };
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      return { status: `error_${res.status}`, error: text };
    }
    return { status: "ok", error: null };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

interface PersistArgs {
  formType: string;
  email: string | null;
  name: string | null;
  company: string | null;
  payload: Record<string, unknown>;
  req: Request;
  webhook: ForwardResult;
}

async function persist(args: PersistArgs): Promise<number> {
  const [row] = await db
    .insert(formSubmissionsTable)
    .values({
      formType: args.formType,
      email: args.email,
      name: args.name,
      company: args.company,
      payload: args.payload,
      ipAddress: clientIp(args.req),
      userAgent: userAgent(args.req),
      webhookStatus: args.webhook.status,
      webhookError: args.webhook.error,
    })
    .returning({ id: formSubmissionsTable.id });
  return row!.id;
}

router.post("/forms/contact", async (req, res): Promise<void> => {
  const parsed = SubmitContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (data.website && data.website.trim() !== "") {
    res.json(SubmitContactResponse.parse({ ok: true, id: 0 }));
    return;
  }
  const ip = clientIp(req);
  if (!(await verifyTurnstile(data.turnstileToken, ip))) {
    res.status(400).json({ error: "Bot check failed. Please reload and try again." });
    return;
  }
  const { turnstileToken: _t, website: _w, ...payload } = data;
  const webhook = await forwardToWebhook({ formType: "contact", ...payload });
  const id = await persist({
    formType: "contact",
    email: payload.email,
    name: payload.name,
    company: payload.company,
    payload,
    req,
    webhook,
  });
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

router.post("/forms/subscribe", async (req, res): Promise<void> => {
  const parsed = SubmitSubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (data.website && data.website.trim() !== "") {
    res.json(SubmitContactResponse.parse({ ok: true, id: 0 }));
    return;
  }
  const ip = clientIp(req);
  if (!(await verifyTurnstile(data.turnstileToken, ip))) {
    res.status(400).json({ error: "Bot check failed. Please reload and try again." });
    return;
  }
  const { turnstileToken: _t, website: _w, ...payload } = data;
  const webhook = await forwardToWebhook({ formType: "subscribe", ...payload });
  const id = await persist({
    formType: "subscribe",
    email: payload.email,
    name: null,
    company: null,
    payload,
    req,
    webhook,
  });
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

router.post("/forms/start", async (req, res): Promise<void> => {
  const parsed = SubmitStartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (data.website && data.website.trim() !== "") {
    res.json(SubmitContactResponse.parse({ ok: true, id: 0 }));
    return;
  }
  const ip = clientIp(req);
  if (!(await verifyTurnstile(data.turnstileToken, ip))) {
    res.status(400).json({ error: "Bot check failed. Please reload and try again." });
    return;
  }
  const { turnstileToken: _t, website: _w, ...payload } = data;
  const webhook = await forwardToWebhook({ formType: "start", ...payload });
  const id = await persist({
    formType: "start",
    email: payload.email,
    name: payload.name,
    company: payload.company,
    payload,
    req,
    webhook,
  });
  res.json(SubmitContactResponse.parse({ ok: true, id }));
});

export default router;
