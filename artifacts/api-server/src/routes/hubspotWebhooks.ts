import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, formSubmissionsTable, subscribersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { resolveContactEmailById } from "../lib/hubspotSync";

// #131 — Inbound webhooks from HubSpot.
//
// HubSpot Public Apps can publish subscription-preference changes (most
// commonly: a contact unsubscribed from the email subscription type backing
// the newsletter). We mirror those events back into our local
// `form_submissions` rows so the on-site newsletter status stays consistent
// with what HubSpot enforces — and so re-subscribe attempts on our end can
// detect a HubSpot-side opt-out.
//
// Signing: HubSpot signs requests with HMAC-SHA256 over the request method,
// URI, body, and timestamp using the app's client secret. We accept v3
// signatures; v2 (raw secret + body) is supported as a fallback for older
// portals. The shared secret comes from `HUBSPOT_WEBHOOK_SECRET` (the app
// client secret) and timestamps must be within 5 minutes.
//
// Without `HUBSPOT_WEBHOOK_SECRET` the route 503s — we don't accept
// unsigned webhooks even in dev.

const router: IRouter = Router();

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

interface SignatureContext {
  method: string;
  uri: string;
  body: string;
  timestamp: string;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function verifyV3(secret: string, sig: string, ctx: SignatureContext): boolean {
  const ts = Number.parseInt(ctx.timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > MAX_TIMESTAMP_SKEW_MS) return false;
  const source = `${ctx.method}${ctx.uri}${ctx.body}${ctx.timestamp}`;
  const expected = crypto.createHmac("sha256", secret).update(source).digest("base64");
  try {
    return timingSafeEqualStr(sig, expected);
  } catch {
    return false;
  }
}

function verifyV2(secret: string, sig: string, ctx: SignatureContext): boolean {
  const source = `${secret}${ctx.method}${ctx.uri}${ctx.body}`;
  const expected = crypto.createHash("sha256").update(source).digest("hex");
  try {
    return timingSafeEqualStr(sig, expected);
  } catch {
    return false;
  }
}

function readSignature(req: Request): { version: "v3" | "v2" | null; sig: string | null; ts: string | null } {
  const v3 = req.header("x-hubspot-signature-v3");
  if (v3) return { version: "v3", sig: v3, ts: req.header("x-hubspot-request-timestamp") ?? null };
  const v2 = req.header("x-hubspot-signature-v2") ?? req.header("x-hubspot-signature");
  if (v2) return { version: "v2", sig: v2, ts: null };
  return { version: null, sig: null, ts: null };
}

interface SubscriptionChangeEvent {
  subscriptionType?: "EMAIL" | "PROPERTY_CHANGE" | string;
  changeType?: string;
  subscriptionId?: number;
  status?: "SUBSCRIBED" | "UNSUBSCRIBED" | string;
  // PROPERTY_CHANGE form
  propertyName?: string;
  propertyValue?: string;
  // Identity
  objectId?: number | string;
  email?: string;
  // Generic
  occurredAt?: number;
  eventId?: string | number;
}

async function applyUnsubscribe(email: string, source: string): Promise<number> {
  // The `subscribers` table is the source of truth for newsletter state
  // post-#259 (DOI). HubSpot-side unsubscribes must flip the canonical
  // row's `status` to `unsubscribed` and stamp `unsubscribedAt`, otherwise
  // /forms/subscribe will happily re-onboard a user HubSpot has already
  // opted out. We additionally mirror onto `form_submissions` as an audit
  // trail so the admin marketing log shows the lineage.
  const lower = email.toLowerCase();
  const subResult = await db
    .update(subscribersTable)
    .set({ status: "unsubscribed", unsubscribedAt: new Date(), confirmationTokenHash: null })
    .where(eq(subscribersTable.email, lower))
    .returning({ id: subscribersTable.id });
  await db
    .update(formSubmissionsTable)
    .set({ marketingOptIn: false, hubspotSyncError: `unsubscribed_via_${source}` })
    .where(
      and(
        eq(formSubmissionsTable.email, lower),
        eq(formSubmissionsTable.formType, "subscribe"),
      ),
    );
  return subResult.length;
}

async function applyResubscribe(email: string): Promise<number> {
  // Mirror a HubSpot-side re-subscribe back to the canonical subscriber
  // row. We move `unsubscribed` rows back to `confirmed` (HubSpot has
  // already validated the address; double-opting them in again on our
  // side would just spam them). `pending` rows are left untouched —
  // those still need their own DOI confirmation.
  const lower = email.toLowerCase();
  const subResult = await db
    .update(subscribersTable)
    .set({ status: "confirmed", unsubscribedAt: null })
    .where(and(eq(subscribersTable.email, lower), eq(subscribersTable.status, "unsubscribed")))
    .returning({ id: subscribersTable.id });
  const [latest] = await db
    .select({ id: formSubmissionsTable.id })
    .from(formSubmissionsTable)
    .where(
      and(
        eq(formSubmissionsTable.email, lower),
        eq(formSubmissionsTable.formType, "subscribe"),
      ),
    )
    .orderBy(desc(formSubmissionsTable.createdAt))
    .limit(1);
  if (latest) {
    await db
      .update(formSubmissionsTable)
      .set({ marketingOptIn: true, hubspotSyncError: null })
      .where(eq(formSubmissionsTable.id, latest.id));
  }
  return subResult.length;
}

router.post(
  "/webhooks/hubspot",
  async (req, res): Promise<void> => {
    const secret = process.env["HUBSPOT_WEBHOOK_SECRET"];
    if (!secret) {
      res.status(503).json({ error: "webhook_secret_unconfigured" });
      return;
    }

    // We need the raw body bytes for signature verification because
    // HubSpot's HMAC is computed over the exact request body the
    // platform sent us. The shared `verify` callback in `app.ts`
    // captures the buffer (#221 / #263); we convert here so signature
    // helpers receive a string. Falls back to a deterministic re-stringify
    // when the buffer is unavailable (e.g. tests that mount this route
    // without the global JSON parser).
    const rawBuf = (req as Request & { rawBody?: Buffer }).rawBody;
    const rawBody = Buffer.isBuffer(rawBuf)
      ? rawBuf.toString("utf8")
      : JSON.stringify(req.body);

    const { version, sig, ts } = readSignature(req);
    if (!version || !sig) {
      res.status(401).json({ error: "missing_signature" });
      return;
    }
    const fullUri = `${req.protocol}://${req.get("host") ?? ""}${req.originalUrl}`;
    const ctx: SignatureContext = {
      method: req.method,
      uri: fullUri,
      body: rawBody,
      timestamp: ts ?? "",
    };
    const ok = version === "v3" ? verifyV3(secret, sig, ctx) : verifyV2(secret, sig, ctx);
    if (!ok) {
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    const events: SubscriptionChangeEvent[] = Array.isArray(req.body)
      ? (req.body as SubscriptionChangeEvent[])
      : [req.body as SubscriptionChangeEvent];

    let applied = 0;
    let ignored = 0;
    for (const ev of events) {
      // HubSpot CRM-event webhooks (subscription/property change) often
      // arrive with only `objectId` and no email. Resolve it via the
      // CRM API so we still mirror those events locally; if HubSpot
      // can't or won't return an email, drop the event.
      let email = (ev.email ?? "").trim().toLowerCase();
      if (!email && ev.objectId !== undefined && ev.objectId !== null) {
        try {
          const looked = await resolveContactEmailById(String(ev.objectId));
          if (looked) email = looked.toLowerCase();
        } catch (err) {
          logger.warn({ err, objectId: ev.objectId }, "HubSpot webhook: contact lookup failed");
        }
      }
      if (!email) {
        ignored += 1;
        continue;
      }
      const isUnsubscribe =
        ev.subscriptionType === "EMAIL" && ev.status === "UNSUBSCRIBED" ||
        ev.changeType === "SUBSCRIPTION_DELETED" ||
        (ev.propertyName === "hs_email_optout" && ev.propertyValue === "true");
      const isResubscribe =
        ev.subscriptionType === "EMAIL" && ev.status === "SUBSCRIBED" ||
        ev.changeType === "SUBSCRIPTION_CREATED" ||
        (ev.propertyName === "hs_email_optout" && ev.propertyValue === "false");

      try {
        if (isUnsubscribe) {
          const n = await applyUnsubscribe(email, "hubspot_webhook");
          applied += n;
          if (n === 0) ignored += 1;
        } else if (isResubscribe) {
          applied += await applyResubscribe(email);
        } else {
          ignored += 1;
        }
      } catch (err) {
        logger.warn({ err, email }, "HubSpot webhook handler failed for event");
      }
    }

    logger.info({ applied, ignored, total: events.length }, "HubSpot webhook processed");
    res.json({ ok: true, applied, ignored });
  },
);

export default router;
