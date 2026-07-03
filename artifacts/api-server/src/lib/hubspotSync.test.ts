/**
 * Unit tests for the HubSpot sync queue (hubspotSync.ts).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:hubspot-sync
 *
 * Covers:
 *   - enqueueContactSubmission: happy path, hubspotEnabled=false short-circuit,
 *     form-toggle-off short-circuit, skip-on-no-email via processOne path.
 *   - drainHubspotQueue: hubspotEnabled=false short-circuit, happy path (200),
 *     retry-on-5xx (stays pending, attempts incremented), dead-letter after
 *     MAX_ATTEMPTS, dead-letter on missing email.
 *   - replayDeadLetter: happy path (true + pending), non-existent id (false),
 *     pending row unchanged (false).
 *
 * The real DB is used (same pattern as every other test in this workspace).
 * The HubSpot HTTP layer is stubbed via globalThis.fetch so no real network
 * calls are made. HUBSPOT_ACCESS_TOKEN is set before the module is imported so
 * isHubspotConfigured() returns true without touching Replit Connectors.
 */

// Must happen before any module load that reads these at import time.
delete process.env["REPLIT_CONNECTORS_HOSTNAME"];
process.env["HUBSPOT_ACCESS_TOKEN"] = "hs-test-token";
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  pool,
  hubspotSyncEventsTable,
  siteSettingsTable,
  formSubmissionsTable,
} from "@workspace/db";
import {
  enqueueContactSubmission,
  drainHubspotQueue,
  replayDeadLetter,
  type EnqueueContactArgs,
} from "./hubspotSync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(tag: string): string {
  return `hs-test-${tag}-${crypto.randomBytes(4).toString("hex")}@example.invalid`;
}

function baseArgs(email: string): EnqueueContactArgs {
  return {
    formType: "contact",
    submissionId: 0,
    email,
    name: "Alice Tester",
    company: "Acme",
    marketingOptIn: true,
    payload: {},
    utm: {},
  };
}

/** Ensure the site_settings id=1 row exists and has the desired hubspotEnabled value. */
async function setSiteHubspotEnabled(enabled: boolean): Promise<boolean | null> {
  // Read previous value so we can restore it after the test.
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

/** Delete all hubspot_sync_events rows by contact_email (cleanup helper). */
async function cleanupEvents(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await db
    .delete(hubspotSyncEventsTable)
    .where(inArray(hubspotSyncEventsTable.contactEmail, emails));
}

/** Insert a hubspot_sync_events row directly for drain/replay tests. */
async function insertSyncEvent(opts: {
  kind: string;
  email: string;
  status?: string;
  attempts?: number;
  nextAttemptAt?: Date;
}): Promise<string> {
  const [row] = await db
    .insert(hubspotSyncEventsTable)
    .values({
      kind: opts.kind,
      contactEmail: opts.email,
      payload: { properties: { email: opts.email }, formType: "contact" },
      status: opts.status ?? "pending",
      attempts: opts.attempts ?? 0,
      nextAttemptAt: opts.nextAttemptAt ?? new Date(Date.now() - 1000),
    })
    .returning();
  return row!.id;
}

// ---------------------------------------------------------------------------
// Fetch stub infrastructure
// ---------------------------------------------------------------------------

type FetchLike = typeof globalThis.fetch;
let fetchStub: FetchLike | null = null;

function installFetch(impl: FetchLike): void {
  fetchStub = impl;
  globalThis.fetch = impl;
}

function mockHubspotOk(contactId = "hs-999"): void {
  installFetch(async () =>
    new Response(JSON.stringify({ id: contactId }), { status: 200 }),
  );
}

function mockHubspot404ThenOk(): void {
  let calls = 0;
  installFetch(async () => {
    calls++;
    if (calls === 1) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ id: "hs-new-001" }), { status: 200 });
  });
}

function mockHubspot5xx(): void {
  installFetch(async () =>
    new Response("internal error", { status: 500 }),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let savedFetch: FetchLike;

test.before(() => {
  savedFetch = globalThis.fetch;
});

test.after(async () => {
  globalThis.fetch = savedFetch;
  await pool.end();
});

// ---------------------------------------------------------------------------
// enqueueContactSubmission
// ---------------------------------------------------------------------------

test("enqueueContactSubmission: skips when hubspotEnabled=false", async () => {
  const prev = await setSiteHubspotEnabled(false);
  const email = uniqueEmail("enq-disabled");
  try {
    await enqueueContactSubmission(baseArgs(email));
    const rows = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.contactEmail, email));
    assert.equal(rows.length, 0, "no rows should be inserted when hubspot is disabled");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("enqueueContactSubmission: skips when form toggle is false for the given formType", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // Disable the "contact" form toggle specifically.
  await db
    .update(siteSettingsTable)
    .set({ hubspotFormToggles: { contact: false } })
    .where(eq(siteSettingsTable.id, 1));

  const email = uniqueEmail("enq-toggle-off");
  try {
    await enqueueContactSubmission({ ...baseArgs(email), formType: "contact" });
    const rows = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.contactEmail, email));
    assert.equal(rows.length, 0, "no rows when formType toggle is false");
  } finally {
    await db
      .update(siteSettingsTable)
      .set({ hubspotFormToggles: null })
      .where(eq(siteSettingsTable.id, 1));
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("enqueueContactSubmission: inserts contact.upsert + timeline event rows when enabled", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("enq-happy");
  try {
    await enqueueContactSubmission({
      ...baseArgs(email),
      formType: "contact",
      utm: { source: "google", medium: "cpc", campaign: "q2" },
    });
    const rows = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.contactEmail, email));
    // One contact.upsert + one timeline.synozur_form_submitted
    assert.equal(rows.length, 2, "should insert 2 rows (contact.upsert + timeline)");
    const kinds = rows.map((r) => r.kind).sort();
    assert.ok(kinds.includes("contact.upsert"), "contact.upsert row expected");
    assert.ok(
      kinds.some((k) => k.startsWith("timeline.")),
      "timeline.* row expected",
    );
    // All rows start as pending.
    assert.ok(
      rows.every((r) => r.status === "pending"),
      "all rows should start as pending",
    );
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("enqueueContactSubmission: subscribes formType maps to 'subscriber' lifecycle", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("enq-subscribe");
  try {
    await enqueueContactSubmission({ ...baseArgs(email), formType: "subscribe" });
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(
        and(
          eq(hubspotSyncEventsTable.contactEmail, email),
          eq(hubspotSyncEventsTable.kind, "contact.upsert"),
        ),
      );
    assert.ok(row, "contact.upsert row should exist");
    const payload = row!.payload as Record<string, unknown>;
    const props = payload["properties"] as Record<string, unknown>;
    assert.equal(props["lifecyclestage"], "subscriber");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("enqueueContactSubmission: hutk is persisted as synozur_hubspotutk property", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("enq-hutk");
  const hutk = "aaabbbccc111";
  try {
    await enqueueContactSubmission({ ...baseArgs(email), hutk });
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(
        and(
          eq(hubspotSyncEventsTable.contactEmail, email),
          eq(hubspotSyncEventsTable.kind, "contact.upsert"),
        ),
      );
    const payload = row!.payload as Record<string, unknown>;
    const props = payload["properties"] as Record<string, unknown>;
    assert.equal(props["synozur_hubspotutk"], hutk, "hutk should be stored as synozur_hubspotutk");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

// ---------------------------------------------------------------------------
// drainHubspotQueue
// ---------------------------------------------------------------------------

test("drainHubspotQueue: returns {processed:0} when hubspotEnabled=false", async () => {
  const prev = await setSiteHubspotEnabled(false);
  try {
    const result = await drainHubspotQueue(10);
    assert.deepEqual(result, { processed: 0 });
  } finally {
    await restoreSiteHubspotEnabled(prev);
  }
});

test("drainHubspotQueue: happy path — marks row succeeded on HubSpot 200", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("drain-ok");
  mockHubspotOk("hs-contact-100");
  const id = await insertSyncEvent({ kind: "contact.upsert", email });
  try {
    const result = await drainHubspotQueue(10);
    assert.ok(result.processed >= 1, "at least 1 row processed");
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "row should be succeeded");
    assert.ok(row?.succeededAt instanceof Date, "succeededAt should be set");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("drainHubspotQueue: PATCH 404 then POST 200 upsert path marks row succeeded", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("drain-404-then-ok");
  mockHubspot404ThenOk();
  const id = await insertSyncEvent({ kind: "contact.upsert", email });
  try {
    await drainHubspotQueue(10);
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "row should succeed after create fallback");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("drainHubspotQueue: retry-on-5xx — row stays pending with incremented attempts", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("drain-retry");
  mockHubspot5xx();
  const id = await insertSyncEvent({ kind: "contact.upsert", email, attempts: 0 });
  try {
    await drainHubspotQueue(10);
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "pending", "5xx should leave row as pending for retry");
    assert.equal(row?.attempts, 1, "attempts should be incremented to 1");
    assert.ok(row?.lastError?.includes("500"), "lastError should mention the 500 status");
    // nextAttemptAt should be in the future (backoff applied).
    assert.ok(
      row!.nextAttemptAt > new Date(),
      "nextAttemptAt should be in the future after backoff",
    );
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("drainHubspotQueue: dead-letters row after MAX_ATTEMPTS (5) failures", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("drain-deadletter");
  mockHubspot5xx();
  // Insert with attempts=4 (next failure hits MAX_ATTEMPTS=5 → dead_letter).
  const id = await insertSyncEvent({ kind: "contact.upsert", email, attempts: 4 });
  try {
    await drainHubspotQueue(10);
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "dead_letter", "should be dead_lettered after MAX_ATTEMPTS");
    assert.equal(row?.attempts, 5);
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("drainHubspotQueue: immediately dead-letters rows with no email", async () => {
  const prev = await setSiteHubspotEnabled(true);
  mockHubspotOk();
  // Insert a row without a contact email.
  const [row] = await db
    .insert(hubspotSyncEventsTable)
    .values({
      kind: "contact.upsert",
      contactEmail: null,
      payload: { properties: {} },
      status: "pending",
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    .returning();
  const id = row!.id;
  try {
    await drainHubspotQueue(10);
    const [updated] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(updated?.status, "dead_letter", "missing email → immediate dead_letter");
    assert.equal(updated?.lastError, "missing_email");
  } finally {
    await db.delete(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, id));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("drainHubspotQueue: timeline.* row without appId is marked skipped", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // Ensure no timeline app id is set.
  await db
    .update(siteSettingsTable)
    .set({ hubspotTimelineAppId: null })
    .where(eq(siteSettingsTable.id, 1));
  mockHubspotOk();
  const email = uniqueEmail("drain-timeline-noid");
  const id = await insertSyncEvent({ kind: "timeline.synozur_form_submitted", email });
  try {
    await drainHubspotQueue(10);
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "skipped", "timeline event without appId should be skipped");
    assert.equal(row?.lastError, "no_timeline_app_id");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

// ---------------------------------------------------------------------------
// replayDeadLetter
// ---------------------------------------------------------------------------

test("replayDeadLetter: resets a dead_letter row to pending and returns true", async () => {
  const email = uniqueEmail("replay-ok");
  const id = await insertSyncEvent({
    kind: "contact.upsert",
    email,
    status: "dead_letter",
    attempts: 5,
    // Set nextAttemptAt in the past so it's picked up immediately when drained.
    nextAttemptAt: new Date(Date.now() - 60_000),
  });
  try {
    const result = await replayDeadLetter(id);
    assert.equal(result, true, "should return true for a dead_letter row");
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "pending", "replayed row should be pending");
    assert.equal(row?.attempts, 0, "attempts should be reset to 0");
    assert.equal(row?.lastError, null, "lastError should be cleared");
  } finally {
    await cleanupEvents([email]);
  }
});

test("replayDeadLetter: returns false for a non-existent id", async () => {
  const result = await replayDeadLetter("00000000-0000-0000-0000-000000000000");
  assert.equal(result, false, "should return false when the id doesn't exist");
});

test("replayDeadLetter: returns false for a pending (non-dead_letter) row", async () => {
  const email = uniqueEmail("replay-pending");
  const id = await insertSyncEvent({ kind: "contact.upsert", email, status: "pending" });
  try {
    const result = await replayDeadLetter(id);
    assert.equal(result, false, "should return false when row is not dead_letter");
  } finally {
    await cleanupEvents([email]);
  }
});
