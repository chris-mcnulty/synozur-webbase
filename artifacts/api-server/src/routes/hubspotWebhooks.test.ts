/**
 * Integration tests for POST /api/webhooks/hubspot.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:hubspot-webhooks
 *
 * Covers:
 *   - 503 when HUBSPOT_WEBHOOK_SECRET is not configured.
 *   - 401 when no signature header is present.
 *   - v3 signature: valid → 200, expired timestamp → 401, mismatched body → 401.
 *   - v2 signature: valid → 200, bad secret → 401.
 *   - Subscription branches:
 *       EMAIL+UNSUBSCRIBED → applyUnsubscribe (mirrors to subscribers + form_submissions)
 *       EMAIL+SUBSCRIBED   → applyResubscribe
 *       hs_email_optout=true  → treat as unsubscribe
 *       hs_email_optout=false → treat as resubscribe
 *       changeType=SUBSCRIPTION_DELETED → unsubscribe
 *       changeType=SUBSCRIPTION_CREATED → resubscribe
 *   - Unrecognised event → ignored (applied=0, ignored=1).
 *   - objectId-only event: resolves email via HubSpot CRM API (stub).
 *   - Multi-event batch: each event processed independently.
 *
 * The Express app is started on an ephemeral port. The real DB is used
 * to verify that subscriber / form_submission rows are mutated correctly.
 * HubSpot outbound calls (contact lookup by objectId) are stubbed via
 * globalThis.fetch before the app module is imported.
 */

// Set env before any module import so the route handler sees the secret.
delete process.env["REPLIT_CONNECTORS_HOSTNAME"];
process.env["HUBSPOT_WEBHOOK_SECRET"] = "super-secret-hs-key-test";
process.env["HUBSPOT_ACCESS_TOKEN"] = "hs-webhook-test-token";
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  subscribersTable,
  formSubmissionsTable,
} from "@workspace/db";
import app from "../app.js";

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

// ---------------------------------------------------------------------------
// Signature helpers (mirror the production implementation)
// ---------------------------------------------------------------------------

const SECRET = process.env["HUBSPOT_WEBHOOK_SECRET"]!;

/**
 * Compute a v3 HMAC-SHA256 signature (base64) over method+uri+body+timestamp.
 * Matches the verifyV3 implementation in hubspotWebhooks.ts.
 */
function signV3(method: string, uri: string, body: string, ts: string): string {
  const source = `${method}${uri}${body}${ts}`;
  return crypto.createHmac("sha256", SECRET).update(source).digest("base64");
}

/**
 * Compute a v2 SHA256 signature (hex) over secret+method+uri+body.
 * Matches the verifyV2 implementation in hubspotWebhooks.ts.
 */
function signV2(method: string, uri: string, body: string): string {
  const source = `${SECRET}${method}${uri}${body}`;
  return crypto.createHash("sha256").update(source).digest("hex");
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface WebhookResponse {
  status: number;
  body: unknown;
}

async function postWebhook(
  events: unknown,
  headers: Record<string, string> = {},
): Promise<WebhookResponse> {
  const body = JSON.stringify(events);
  const url = `${baseUrl}/api/webhooks/hubspot`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

/**
 * Build a complete set of v3 signature headers for the given body, pointing
 * at the ephemeral test server URL. The timestamp is `Date.now()` by default
 * (within the 5-minute skew window).
 */
function v3Headers(rawBody: string, overrides: { ts?: string } = {}): Record<string, string> {
  const ts = overrides.ts ?? String(Date.now());
  const uri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/hubspot`;
  const sig = signV3("POST", uri, rawBody, ts);
  return {
    "x-hubspot-signature-v3": sig,
    "x-hubspot-request-timestamp": ts,
  };
}

function v2Headers(rawBody: string): Record<string, string> {
  const uri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/hubspot`;
  const sig = signV2("POST", uri, rawBody);
  return { "x-hubspot-signature-v2": sig };
}

// ---------------------------------------------------------------------------
// DB fixtures helpers
// ---------------------------------------------------------------------------

function uniqueEmail(tag: string): string {
  return `webhook-test-${tag}-${crypto.randomBytes(4).toString("hex")}@example.invalid`;
}

/** Insert a subscriber row so applyUnsubscribe has something to flip. */
async function insertSubscriber(email: string, status = "confirmed"): Promise<void> {
  await db
    .insert(subscribersTable)
    .values({ email, status })
    .onConflictDoUpdate({
      target: subscribersTable.email,
      set: { status },
    });
}

/** Insert a subscribe form submission row. */
async function insertSubscribeSubmission(email: string): Promise<void> {
  const existing = await db.query.formSubmissionsTable.findFirst({
    where: and(
      eq(formSubmissionsTable.email, email),
      eq(formSubmissionsTable.formType, "subscribe"),
    ),
  });
  if (!existing) {
    await db.insert(formSubmissionsTable).values({
      email,
      formType: "subscribe",
      marketingOptIn: true,
      payload: {},
    });
  }
}

async function cleanup(email: string): Promise<void> {
  await db.delete(subscribersTable).where(eq(subscribersTable.email, email));
  await db
    .delete(formSubmissionsTable)
    .where(eq(formSubmissionsTable.email, email));
}

// ---------------------------------------------------------------------------
// Configuration guard tests
// ---------------------------------------------------------------------------

test("POST /api/webhooks/hubspot: 503 when HUBSPOT_WEBHOOK_SECRET is unset", async () => {
  const saved = process.env["HUBSPOT_WEBHOOK_SECRET"];
  delete process.env["HUBSPOT_WEBHOOK_SECRET"];
  try {
    const events = [{ subscriptionType: "EMAIL", status: "UNSUBSCRIBED", email: "nobody@example.invalid" }];
    const rawBody = JSON.stringify(events);
    // No signature needed — the check happens before signature verification.
    const res = await postWebhook(events, {});
    assert.equal(res.status, 503, "should 503 when the webhook secret env var is absent");
    assert.deepEqual((res.body as Record<string, string>).error, "webhook_secret_unconfigured");
  } finally {
    process.env["HUBSPOT_WEBHOOK_SECRET"] = saved;
  }
});

test("POST /api/webhooks/hubspot: 401 when no signature header is present", async () => {
  const events = [{ email: "nobody@example.invalid" }];
  const res = await postWebhook(events);
  assert.equal(res.status, 401);
  assert.deepEqual((res.body as Record<string, string>).error, "missing_signature");
});

// ---------------------------------------------------------------------------
// v3 signature verification
// ---------------------------------------------------------------------------

test("POST /api/webhooks/hubspot: 200 on valid v3 signature", async () => {
  const events = [{ subscriptionType: "UNKNOWN_TYPE" }];
  const rawBody = JSON.stringify(events);
  const res = await postWebhook(events, v3Headers(rawBody));
  assert.equal(res.status, 200, "valid v3 sig should be accepted");
});

test("POST /api/webhooks/hubspot: 401 on expired v3 timestamp (>5 min old)", async () => {
  const events = [{ subscriptionType: "UNKNOWN_TYPE" }];
  const rawBody = JSON.stringify(events);
  // Timestamp is 6 minutes in the past.
  const expiredTs = String(Date.now() - 6 * 60 * 1000);
  const headers = v3Headers(rawBody, { ts: expiredTs });
  const res = await postWebhook(events, headers);
  assert.equal(res.status, 401, "expired v3 timestamp should be rejected");
  assert.deepEqual((res.body as Record<string, string>).error, "invalid_signature");
});

test("POST /api/webhooks/hubspot: 401 when v3 body does not match signature", async () => {
  const events = [{ subscriptionType: "UNKNOWN_TYPE" }];
  const rawBody = JSON.stringify(events);
  const headers = v3Headers(rawBody);
  // Tamper with the body after computing the signature.
  const tamperedEvents = [{ subscriptionType: "TAMPERED" }];
  const res = await postWebhook(tamperedEvents, headers);
  assert.equal(res.status, 401, "mismatched body should fail v3 sig verification");
  assert.deepEqual((res.body as Record<string, string>).error, "invalid_signature");
});

test("POST /api/webhooks/hubspot: 401 when v3 signature uses wrong secret", async () => {
  const events = [{ subscriptionType: "UNKNOWN_TYPE" }];
  const rawBody = JSON.stringify(events);
  const ts = String(Date.now());
  const uri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/hubspot`;
  // Sign with a different secret.
  const wrongSig = crypto.createHmac("sha256", "wrong-secret").update(`POST${uri}${rawBody}${ts}`).digest("base64");
  const res = await postWebhook(events, {
    "x-hubspot-signature-v3": wrongSig,
    "x-hubspot-request-timestamp": ts,
  });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// v2 signature verification
// ---------------------------------------------------------------------------

test("POST /api/webhooks/hubspot: 200 on valid v2 signature", async () => {
  const events = [{ subscriptionType: "UNKNOWN_TYPE" }];
  const rawBody = JSON.stringify(events);
  const res = await postWebhook(events, v2Headers(rawBody));
  assert.equal(res.status, 200, "valid v2 sig should be accepted");
});

test("POST /api/webhooks/hubspot: 401 on invalid v2 signature", async () => {
  const events = [{ subscriptionType: "UNKNOWN_TYPE" }];
  const rawBody = JSON.stringify(events);
  const badSig = crypto.createHash("sha256").update("wrong-secret-POST-body").digest("hex");
  const res = await postWebhook(events, { "x-hubspot-signature-v2": badSig });
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Subscription event branches
// ---------------------------------------------------------------------------

test("EMAIL + UNSUBSCRIBED → unsubscribes the contact in the DB", async () => {
  const email = uniqueEmail("unsub");
  await insertSubscriber(email, "confirmed");
  await insertSubscribeSubmission(email);
  const events = [{ subscriptionType: "EMAIL", status: "UNSUBSCRIBED", email }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const body = res.body as { applied: number; ignored: number };
    assert.ok(body.applied >= 1, "at least 1 row applied");
    const sub = await db.query.subscribersTable.findFirst({
      where: eq(subscribersTable.email, email),
    });
    assert.equal(sub?.status, "unsubscribed", "subscriber should be unsubscribed");
    assert.ok(sub?.unsubscribedAt instanceof Date, "unsubscribedAt should be set");
  } finally {
    await cleanup(email);
  }
});

test("EMAIL + SUBSCRIBED → resubscribes an unsubscribed contact", async () => {
  const email = uniqueEmail("resub");
  await insertSubscriber(email, "unsubscribed");
  await insertSubscribeSubmission(email);
  const events = [{ subscriptionType: "EMAIL", status: "SUBSCRIBED", email }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const sub = await db.query.subscribersTable.findFirst({
      where: eq(subscribersTable.email, email),
    });
    assert.equal(sub?.status, "confirmed", "previously unsubscribed contact should be confirmed");
    assert.equal(sub?.unsubscribedAt, null, "unsubscribedAt should be cleared");
  } finally {
    await cleanup(email);
  }
});

test("hs_email_optout=true property change → treated as unsubscribe", async () => {
  const email = uniqueEmail("optout-true");
  await insertSubscriber(email, "confirmed");
  const events = [{ propertyName: "hs_email_optout", propertyValue: "true", email }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const sub = await db.query.subscribersTable.findFirst({
      where: eq(subscribersTable.email, email),
    });
    assert.equal(sub?.status, "unsubscribed");
  } finally {
    await cleanup(email);
  }
});

test("hs_email_optout=false property change → treated as resubscribe", async () => {
  const email = uniqueEmail("optout-false");
  await insertSubscriber(email, "unsubscribed");
  const events = [{ propertyName: "hs_email_optout", propertyValue: "false", email }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const sub = await db.query.subscribersTable.findFirst({
      where: eq(subscribersTable.email, email),
    });
    assert.equal(sub?.status, "confirmed");
  } finally {
    await cleanup(email);
  }
});

test("changeType=SUBSCRIPTION_DELETED → unsubscribe", async () => {
  const email = uniqueEmail("change-del");
  await insertSubscriber(email, "confirmed");
  const events = [{ changeType: "SUBSCRIPTION_DELETED", email }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const sub = await db.query.subscribersTable.findFirst({
      where: eq(subscribersTable.email, email),
    });
    assert.equal(sub?.status, "unsubscribed");
  } finally {
    await cleanup(email);
  }
});

test("changeType=SUBSCRIPTION_CREATED → resubscribe", async () => {
  const email = uniqueEmail("change-add");
  await insertSubscriber(email, "unsubscribed");
  const events = [{ changeType: "SUBSCRIPTION_CREATED", email }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const sub = await db.query.subscribersTable.findFirst({
      where: eq(subscribersTable.email, email),
    });
    assert.equal(sub?.status, "confirmed");
  } finally {
    await cleanup(email);
  }
});

test("unrecognised event type → ignored (applied=0, ignored=1)", async () => {
  const events = [{ subscriptionType: "SOME_FUTURE_TYPE", email: "nobody@example.invalid" }];
  const rawBody = JSON.stringify(events);
  const res = await postWebhook(events, v3Headers(rawBody));
  assert.equal(res.status, 200);
  const body = res.body as { applied: number; ignored: number };
  assert.equal(body.ignored, 1, "unrecognised event should be counted as ignored");
  assert.equal(body.applied, 0);
});

// ---------------------------------------------------------------------------
// Multi-event batch
// ---------------------------------------------------------------------------

test("multi-event batch: each event is processed independently", async () => {
  const emailA = uniqueEmail("batch-a");
  const emailB = uniqueEmail("batch-b");
  await insertSubscriber(emailA, "confirmed");
  await insertSubscriber(emailB, "unsubscribed");
  const events = [
    { subscriptionType: "EMAIL", status: "UNSUBSCRIBED", email: emailA },
    { subscriptionType: "EMAIL", status: "SUBSCRIBED", email: emailB },
  ];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const body = res.body as { applied: number };
    assert.ok(body.applied >= 2, "both events should be applied");
    const subA = await db.query.subscribersTable.findFirst({ where: eq(subscribersTable.email, emailA) });
    const subB = await db.query.subscribersTable.findFirst({ where: eq(subscribersTable.email, emailB) });
    assert.equal(subA?.status, "unsubscribed", "emailA should be unsubscribed");
    assert.equal(subB?.status, "confirmed", "emailB should be confirmed");
  } finally {
    await cleanup(emailA);
    await cleanup(emailB);
  }
});

// ---------------------------------------------------------------------------
// objectId-only lookup via HubSpot CRM API (stub)
// ---------------------------------------------------------------------------

test("objectId-only event: resolves email via stubbed HubSpot CRM API then applies action", async () => {
  const email = uniqueEmail("obj-id-lookup");
  await insertSubscriber(email, "confirmed");

  const savedFetch = globalThis.fetch;
  // Stub the outbound HubSpot contact lookup, forwarding all other requests.
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input] = args;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.includes("/crm/v3/objects/contacts/")) {
      return new Response(JSON.stringify({ properties: { email } }), { status: 200 });
    }
    return savedFetch(...args);
  };

  const events = [{ subscriptionType: "EMAIL", status: "UNSUBSCRIBED", objectId: 99999 }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    const sub = await db.query.subscribersTable.findFirst({ where: eq(subscribersTable.email, email) });
    assert.equal(sub?.status, "unsubscribed", "contact resolved via objectId should be unsubscribed");
  } finally {
    globalThis.fetch = savedFetch;
    await cleanup(email);
  }
});

test("objectId-only event: drops event gracefully when CRM lookup returns no email", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input] = args;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.includes("/crm/v3/objects/contacts/")) {
      return new Response(JSON.stringify({ properties: { email: null } }), { status: 200 });
    }
    return savedFetch(...args);
  };

  const events = [{ subscriptionType: "EMAIL", status: "UNSUBSCRIBED", objectId: 11111 }];
  const rawBody = JSON.stringify(events);
  try {
    const res = await postWebhook(events, v3Headers(rawBody));
    assert.equal(res.status, 200);
    // No email resolved → event must be ignored, not throw.
    const body = res.body as { ignored: number };
    assert.ok(body.ignored >= 1, "event with unresolvable objectId should be ignored");
  } finally {
    globalThis.fetch = savedFetch;
  }
});
