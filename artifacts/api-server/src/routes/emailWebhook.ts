import { Router, type IRouter, type Request } from "express";
import { createPublicKey, createVerify } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  emailEventsTable,
  emailMessagesTable,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";

// #221 — SendGrid Event Webhook ingest.
//
// SendGrid POSTs a JSON array of event objects to this endpoint whenever
// it observes a delivery state change for a message we sent (delivered,
// bounce, dropped, deferred, processed, spamreport, open, click,
// unsubscribe, group_unsubscribe, group_resubscribe).
//
// Authenticity is enforced via SendGrid's "Signed Event Webhook" feature:
// each request carries an ECDSA signature header signed over
// `<timestamp><raw-body>`. The verification public key is provided when
// the feature is enabled in the SendGrid UI; we read it from
// `SENDGRID_WEBHOOK_PUBLIC_KEY` (the connector does not surface it).
//
// Each event row is keyed by `sg_message_id`. The portion before the
// first `.` matches the `X-Message-Id` we recorded in `email_messages`
// at send time, which is how the admin view links events back to the
// originating send.

const SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
const TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";

interface SendGridEvent {
  email?: string;
  event?: string;
  sg_message_id?: string;
  timestamp?: number;
  reason?: string;
  response?: string;
  type?: string;
  [k: string]: unknown;
}

function getPublicKeyPem(): string | null {
  const raw =
    process.env["SENDGRID_WEBHOOK_PUBLIC_KEY"] ??
    process.env["SENDGRID_WEBHOOK_VERIFICATION_KEY"] ??
    "";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Accept either a PEM block or the bare base64 SPKI body that SendGrid's
  // dashboard shows. Wrap the bare form in PEM headers so createPublicKey
  // can ingest it directly.
  if (trimmed.includes("BEGIN PUBLIC KEY")) return trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${trimmed.replace(/\s+/g, "")}\n-----END PUBLIC KEY-----`;
}

function verifySignature(
  rawBody: Buffer,
  timestamp: string,
  signatureB64: string,
): boolean {
  const pem = getPublicKeyPem();
  if (!pem) return false;
  try {
    const key = createPublicKey(pem);
    const verifier = createVerify("sha256");
    verifier.update(timestamp);
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(key, signatureB64, "base64");
  } catch (err) {
    logger.warn({ err }, "sendgrid-webhook: signature verification threw");
    return false;
  }
}

function messageIdPrefix(sgMessageId: string): string {
  // SendGrid's sg_message_id is "<X-Message-Id>.<filter>-<random>". The
  // portion before the first "." is the value we recorded in email_messages.
  const dot = sgMessageId.indexOf(".");
  return dot === -1 ? sgMessageId : sgMessageId.slice(0, dot);
}

function trim(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

const router: IRouter = Router();

router.post("/email/sendgrid-webhook", async (req: Request, res) => {
  const signature = req.headers[SIGNATURE_HEADER];
  const timestamp = req.headers[TIMESTAMP_HEADER];
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

  if (
    typeof signature !== "string" ||
    typeof timestamp !== "string" ||
    !rawBody
  ) {
    res.status(401).json({ error: "Missing signature headers" });
    return;
  }

  if (!verifySignature(rawBody, timestamp, signature)) {
    logger.warn(
      { ip: req.ip },
      "sendgrid-webhook: signature verification failed",
    );
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const body = req.body;
  if (!Array.isArray(body)) {
    res.status(400).json({ error: "Expected JSON array of events" });
    return;
  }

  let stored = 0;
  for (const entry of body as SendGridEvent[]) {
    if (!entry || typeof entry !== "object") continue;
    const sgMessageId = trim(entry.sg_message_id, 256);
    const eventName = trim(entry.event, 64);
    if (!sgMessageId || !eventName) continue;

    const epoch =
      typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
        ? entry.timestamp
        : Math.floor(Date.now() / 1000);
    const eventAt = new Date(epoch * 1000);

    const prefix = messageIdPrefix(sgMessageId);
    // Look up the originating send so we can fill in the FK and bump the
    // denormalized latest_event/latest_event_at on email_messages.
    const messageRow = await db
      .select({ id: emailMessagesTable.id })
      .from(emailMessagesTable)
      .where(sql`${emailMessagesTable.messageId} = ${prefix}`)
      .limit(1);
    const emailMessageId = messageRow[0]?.id ?? null;

    try {
      await db.insert(emailEventsTable).values({
        emailMessageId,
        sgMessageId,
        event: eventName,
        emailAddr: trim(entry.email, 320),
        reason:
          trim(entry.reason, 1024) ?? trim(entry.response, 1024) ?? null,
        payload: entry as object,
        eventAt,
      });
      stored += 1;
    } catch (err) {
      logger.warn(
        { err, sgMessageId, eventName },
        "sendgrid-webhook: failed to persist event",
      );
      continue;
    }

    if (emailMessageId) {
      try {
        // Only advance latest_event if this event is newer than what we
        // already have — webhook deliveries can arrive slightly out of
        // order so we don't want a late "processed" overwriting "delivered".
        await db.execute(sql`
          UPDATE email_messages
             SET latest_event = ${eventName},
                 latest_event_at = ${eventAt.toISOString()}
           WHERE id = ${emailMessageId}
             AND (latest_event_at IS NULL OR latest_event_at <= ${eventAt.toISOString()})
        `);
      } catch (err) {
        logger.warn(
          { err, emailMessageId },
          "sendgrid-webhook: failed to update latest_event",
        );
      }
    }
  }

  logger.info(
    { stored, total: body.length },
    "sendgrid-webhook: events ingested",
  );
  res.status(204).end();
});

export default router;
