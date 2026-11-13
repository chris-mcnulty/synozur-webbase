/**
 * Connectors SDK path tests for hubspotProxy / drainHubspotQueue.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:hubspot-sync
 *
 * This file is intentionally separate from hubspotSync.test.ts so that the
 * module-level constant REPLIT_CONNECTORS_AVAILABLE (evaluated once at import
 * time) is set to `true` in this process, while hubspotSync.test.ts runs in a
 * separate process with REPLIT_CONNECTORS_HOSTNAME deleted.
 *
 * Covers:
 *   - hubspotProxy SDK path: Content-Type is forwarded on PATCH (upsert) requests
 *   - hubspotProxy SDK path: Content-Type is forwarded on POST (create) requests
 *   - hubspotProxy SDK path: no Content-Type header on body-less GET requests
 */

// Must happen before any module load that reads these env vars at import time.
process.env["REPLIT_CONNECTORS_HOSTNAME"] = "connectors-test-host:1234";
delete process.env["HUBSPOT_ACCESS_TOKEN"];
process.env["EMAIL_DISABLED"] = "1";

import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool, hubspotSyncEventsTable, siteSettingsTable } from "@workspace/db";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// ReplitConnectors stub — captures every call to connectors.proxy()
// ---------------------------------------------------------------------------

type ProxyCall = {
  service: string;
  path: string;
  init: { method?: string; body?: string; headers?: Record<string, string> };
};

let proxyCalls: ProxyCall[] = [];
// Allows individual tests to override the response returned by the stub.
let proxyResponseFactory: () => Response = () =>
  new Response(JSON.stringify({ id: "hs-sdk-999" }), { status: 200 });

// mock.module must be called before the module under test is imported.
await mock.module("@replit/connectors-sdk", {
  namedExports: {
    ReplitConnectors: class MockReplitConnectors {
      proxy(service: string, path: string, init: ProxyCall["init"]) {
        proxyCalls.push({ service, path, init: { ...init } });
        return Promise.resolve(proxyResponseFactory());
      }
    },
  },
});

// Now import hubspotSync so it picks up:
//   1. REPLIT_CONNECTORS_HOSTNAME set → REPLIT_CONNECTORS_AVAILABLE = true
//   2. The mocked @replit/connectors-sdk above
const { drainHubspotQueue } = await import("./hubspotSync.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(tag: string): string {
  return `hs-sdk-test-${tag}-${crypto.randomBytes(4).toString("hex")}@example.invalid`;
}

async function setSiteHubspotEnabled(enabled: boolean): Promise<boolean | null> {
  const existing = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.id, 1),
  });
  const prev = existing?.hubspotEnabled ?? null;
  if (existing) {
    await db
      .update(siteSettingsTable)
      .set({ hubspotEnabled: enabled })
      .where(eq(siteSettingsTable.id, 1));
  } else {
    await db.insert(siteSettingsTable).values({ id: 1, hubspotEnabled: enabled });
  }
  return prev;
}

async function restoreSiteHubspotEnabled(prev: boolean | null): Promise<void> {
  if (prev === null) {
    await db.delete(siteSettingsTable).where(eq(siteSettingsTable.id, 1));
  } else {
    await db
      .update(siteSettingsTable)
      .set({ hubspotEnabled: prev })
      .where(eq(siteSettingsTable.id, 1));
  }
}

async function cleanupEvents(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db
    .delete(hubspotSyncEventsTable)
    .where(inArray(hubspotSyncEventsTable.contactEmail, emails));
}

async function insertPendingUpsert(email: string): Promise<string> {
  const [row] = await db
    .insert(hubspotSyncEventsTable)
    .values({
      kind: "contact.upsert",
      contactEmail: email,
      payload: {
        properties: { email },
        formType: "contact",
      },
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    .returning();
  return row!.id;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test.after(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// Tests: Content-Type header forwarding through the Connectors SDK path
// ---------------------------------------------------------------------------

test("SDK path: Content-Type application/json is forwarded on PATCH (contact upsert)", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("sdk-patch");
  proxyCalls = [];
  proxyResponseFactory = () =>
    new Response(JSON.stringify({ id: "hs-sdk-patch-001" }), { status: 200 });

  const id = await insertPendingUpsert(email);
  try {
    await drainHubspotQueue(10);

    // drainHubspotQueue tries PATCH first; find that call.
    const patchCall = proxyCalls.find(
      (c) => (c.init.method ?? "GET").toUpperCase() === "PATCH",
    );
    assert.ok(patchCall, "proxy() should have been called with PATCH");
    assert.equal(
      patchCall!.init.headers?.["Content-Type"],
      "application/json",
      "Content-Type: application/json must be forwarded on PATCH requests through the SDK path",
    );

    // Confirm the row succeeded so the test is end-to-end meaningful.
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "row should be succeeded after SDK PATCH");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("SDK path: Content-Type application/json is forwarded on POST (contact create fallback)", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("sdk-post");
  proxyCalls = [];

  // First call → 404 (PATCH miss), second call → 200 (POST create).
  let callCount = 0;
  proxyResponseFactory = () => {
    callCount++;
    if (callCount === 1) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ id: "hs-sdk-create-001" }), { status: 200 });
  };

  const id = await insertPendingUpsert(email);
  try {
    await drainHubspotQueue(10);

    const postCall = proxyCalls.find(
      (c) => (c.init.method ?? "GET").toUpperCase() === "POST",
    );
    assert.ok(postCall, "proxy() should have been called with POST for the create fallback");
    assert.equal(
      postCall!.init.headers?.["Content-Type"],
      "application/json",
      "Content-Type: application/json must be forwarded on POST requests through the SDK path",
    );

    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "row should be succeeded after SDK POST create");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("SDK path: no Content-Type header on body-less GET (template lookup)", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("sdk-get");
  proxyCalls = [];

  // Return an app-id in settings so the timeline path resolves the template.
  await db
    .update(siteSettingsTable)
    .set({ hubspotTimelineAppId: "42" })
    .where(eq(siteSettingsTable.id, 1));

  // Respond to the GET (template list) and POST (timeline event) calls.
  proxyResponseFactory = () => {
    const lastCall = proxyCalls[proxyCalls.length - 1];
    if (lastCall && (lastCall.init.method ?? "GET").toUpperCase() === "GET") {
      // Template list response.
      return new Response(
        JSON.stringify({ results: [{ id: "tmpl-1", name: "synozur_form_submitted" }] }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  };

  // Insert a timeline event rather than a contact.upsert so the GET path is exercised.
  const [row] = await db
    .insert(hubspotSyncEventsTable)
    .values({
      kind: "timeline.synozur_form_submitted",
      contactEmail: email,
      payload: {
        formType: "contact",
        tokens: { form_type: "contact" },
      },
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    .returning();
  const id = row!.id;

  try {
    await drainHubspotQueue(10);

    const getCall = proxyCalls.find(
      (c) => (c.init.method === undefined || c.init.method.toUpperCase() === "GET"),
    );
    assert.ok(getCall, "proxy() should have been called without a method (GET) for template lookup");
    assert.equal(
      getCall!.init.headers?.["Content-Type"],
      undefined,
      "Content-Type should NOT be set on body-less GET requests through the SDK path",
    );
  } finally {
    await db.delete(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, id));
    await db
      .update(siteSettingsTable)
      .set({ hubspotTimelineAppId: null })
      .where(eq(siteSettingsTable.id, 1));
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});
