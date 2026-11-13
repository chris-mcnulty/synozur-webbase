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
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  hubspotSyncEventsTable,
  siteSettingsTable,
  formSubmissionsTable,
  clientOrganizationsTable,
  engagementsTable,
} from "@workspace/db";
import {
  enqueueContactSubmission,
  drainHubspotQueue,
  replayDeadLetter,
  enqueueCompanyUpsert,
  enqueueDealUpsert,
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

// ---------------------------------------------------------------------------
// company.upsert and deal.upsert
// ---------------------------------------------------------------------------

/**
 * Sequence-based fetch mock: each call returns the next response in the list;
 * once exhausted it repeats the last entry. This lets tests predict the exact
 * HubSpot call order without URL matching.
 */
function mockFetchSequence(responses: Array<{ status: number; body?: unknown }>): void {
  let i = 0;
  installFetch(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  });
}

/** MISSING_SCOPES body that triggers the isMissingScope guard. */
const MISSING_SCOPES_BODY = { message: "MISSING_SCOPES", status: "FORBIDDEN" };

/** Insert a sync event without a contact email (used for company/deal kinds). */
async function insertGenericEvent(opts: {
  kind: string;
  payload: Record<string, unknown>;
  status?: string;
  attempts?: number;
}): Promise<string> {
  const [row] = await db
    .insert(hubspotSyncEventsTable)
    .values({
      kind: opts.kind,
      contactEmail: null,
      payload: opts.payload,
      status: opts.status ?? "pending",
      attempts: opts.attempts ?? 0,
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    .returning();
  return row!.id;
}

/** Insert a minimal clientOrganization row and return it. */
async function insertTestOrg(overrides: {
  hubspotCompanyId?: string | null;
  approvedEmailDomains?: string[];
  isActive?: boolean;
  deletedAt?: Date | null;
} = {}): Promise<{ id: string; slug: string }> {
  const slug = `test-org-${crypto.randomBytes(4).toString("hex")}`;
  const [org] = await db
    .insert(clientOrganizationsTable)
    .values({
      name: "Test Org",
      slug,
      approvedEmailDomains: overrides.approvedEmailDomains ?? [`${slug}.example`],
      hubspotCompanyId: overrides.hubspotCompanyId ?? null,
      isActive: overrides.isActive ?? true,
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning();
  return { id: org!.id, slug: org!.slug };
}

// --- contact.upsert company association ---

test("contact.upsert: matching email domain associates contact with its HubSpot Company", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const domain = `contact-assoc-${crypto.randomBytes(4).toString("hex")}.example`;
  const email = `person@${domain.toUpperCase()}`;
  const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
  installFetch(async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(
      requests.length === 1 ? { id: "hs-contact-associated" } : {},
    ), { status: 200 });
  });
  const { id: orgId } = await insertTestOrg({
    hubspotCompanyId: "hs-company-associated",
    approvedEmailDomains: [domain],
  });
  const eventId = await insertSyncEvent({ kind: "contact.upsert", email });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded");
    const association = requests.find((request) => request.url.includes("/associations/companies/"));
    assert.ok(association, "Contact → Company association request should be sent");
    assert.ok(association.url.endsWith("/crm/v4/objects/contacts/hs-contact-associated/associations/companies/hs-company-associated"));
    assert.equal(association.method, "PUT");
    assert.deepEqual(JSON.parse(association.body ?? "null"), [
      { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 },
    ]);
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("contact.upsert: transient association failure leaves event pending for retry", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const domain = `contact-assoc-fail-${crypto.randomBytes(4).toString("hex")}.example`;
  const email = `person@${domain}`;
  let calls = 0;
  installFetch(async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ id: "hs-contact-assoc-fail" }), { status: 200 })
      : new Response("association unavailable", { status: 500 });
  });
  const { id: orgId } = await insertTestOrg({
    hubspotCompanyId: "hs-company-assoc-fail",
    approvedEmailDomains: [domain],
  });
  const eventId = await insertSyncEvent({ kind: "contact.upsert", email });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "pending");
    assert.equal(event?.attempts, 1);
    assert.ok(event?.lastError?.includes("contact_company_assoc_500"));
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("contact.upsert: deleted, inactive, and duplicate-domain organizations are not arbitrarily associated", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const domain = `contact-ineligible-${crypto.randomBytes(4).toString("hex")}.example`;
  const email = `person@${domain}`;
  const requestedUrls: string[] = [];
  installFetch(async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ id: "hs-contact-ineligible" }), { status: 200 });
  });
  const orgs = await Promise.all([
    insertTestOrg({ hubspotCompanyId: "hs-deleted", approvedEmailDomains: [domain], deletedAt: new Date() }),
    insertTestOrg({ hubspotCompanyId: "hs-inactive", approvedEmailDomains: [domain], isActive: false }),
    insertTestOrg({ hubspotCompanyId: "hs-duplicate-a", approvedEmailDomains: [domain] }),
    insertTestOrg({ hubspotCompanyId: "hs-duplicate-b", approvedEmailDomains: [domain.toUpperCase()] }),
  ]);
  const eventId = await insertSyncEvent({ kind: "contact.upsert", email });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded");
    assert.equal(
      requestedUrls.filter((url) => url.includes("/associations/companies/")).length,
      0,
      "ambiguous eligible domain matches must not pick a company arbitrarily",
    );
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(inArray(clientOrganizationsTable.id, orgs.map((org) => org.id)));
    await restoreSiteHubspotEnabled(prev);
  }
});

/** Insert a minimal engagement row and return its id. */
async function insertTestEngagement(clientOrganizationId: string): Promise<string> {
  const slug = `eng-${crypto.randomBytes(4).toString("hex")}`;
  const [eng] = await db
    .insert(engagementsTable)
    .values({
      clientOrganizationId,
      title: "Test Engagement",
      slug,
      status: "active",
    })
    .returning();
  return eng!.id;
}

/** Remove a single sync event row by id. */
async function cleanupEventById(id: string): Promise<void> {
  await db.delete(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, id));
}

// --- company.upsert ---

test("company.upsert: search-empty → POST creates company, marks succeeded, writes hubspotCompanyId", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // Search returns nothing → POST creates the company.
  mockFetchSequence([
    { status: 200, body: { results: [] } },                      // search
    { status: 200, body: { id: "hs-company-create-1" } },        // POST create
  ]);
  const { id: orgId, slug } = await insertTestOrg();
  const eventId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Test Org", slug, approvedEmailDomains: [`${slug}.example`] },
  });
  try {
    const result = await drainHubspotQueue(10);
    assert.ok(result.processed >= 1, "at least 1 row processed");
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded", "company.upsert should be succeeded");
    const [org] = await db.select().from(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    assert.equal(org?.hubspotCompanyId, "hs-company-create-1", "hubspotCompanyId should be written to the org row");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("company.upsert: search-found → PATCH updates existing company, marks succeeded", async () => {
  const prev = await setSiteHubspotEnabled(true);
  mockFetchSequence([
    { status: 200, body: { results: [{ id: "hs-company-existing" }] } }, // search found
    { status: 200, body: { id: "hs-company-existing" } },                // PATCH
  ]);
  const { id: orgId, slug } = await insertTestOrg({ hubspotCompanyId: "hs-company-existing" });
  const eventId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Test Org Updated", slug, approvedEmailDomains: [`${slug}.example`] },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded", "company.upsert patch path should be succeeded");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("company.upsert: 403 MISSING_SCOPES → immediately dead_lettered with missing_scope error", async () => {
  const prev = await setSiteHubspotEnabled(true);
  mockFetchSequence([
    { status: 200, body: { results: [] } },             // search
    { status: 403, body: MISSING_SCOPES_BODY },          // POST → scope error
  ]);
  const { id: orgId, slug } = await insertTestOrg();
  const eventId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Test Org", slug, approvedEmailDomains: [] },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "dead_letter", "scope error should dead-letter immediately");
    assert.ok(event?.lastError?.includes("missing_scope"), `lastError should contain missing_scope, got: ${event?.lastError}`);
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("company.upsert: 5xx from HubSpot → stays pending with backoff", async () => {
  const prev = await setSiteHubspotEnabled(true);
  mockFetchSequence([
    { status: 200, body: { results: [] } }, // search
    { status: 500, body: {} },               // POST → transient error
  ]);
  const { id: orgId, slug } = await insertTestOrg();
  const eventId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Test Org", slug, approvedEmailDomains: [] },
    attempts: 0,
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "pending", "5xx should leave event pending for retry");
    assert.equal(event?.attempts, 1, "attempts should be incremented");
    assert.ok(event!.nextAttemptAt > new Date(), "nextAttemptAt should be in the future");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

// --- deal.upsert ---

test("deal.upsert: creates deal, associates with company, marks succeeded, writes hubspotDealId", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // search (deal), POST deal, PUT association
  mockFetchSequence([
    { status: 200, body: { results: [] } },              // deal search
    { status: 200, body: { id: "hs-deal-ok-1" } },       // deal POST create
    { status: 200, body: {} },                            // association PUT
  ]);
  const { id: orgId } = await insertTestOrg({ hubspotCompanyId: "hs-company-parent" });
  const engagementId = await insertTestEngagement(orgId);
  const eventId = await insertGenericEvent({
    kind: "deal.upsert",
    payload: { engagementId, clientOrganizationId: orgId, title: "Test Deal", status: "active", startedAt: new Date().toISOString(), summary: null },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded", "deal.upsert with company should be succeeded");
    const [eng] = await db.select().from(engagementsTable).where(eq(engagementsTable.id, engagementId));
    assert.equal(eng?.hubspotDealId, "hs-deal-ok-1", "hubspotDealId should be written to the engagement row");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(engagementsTable).where(eq(engagementsTable.id, engagementId));
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("deal.upsert: company not yet synced → event stays pending, deal ID is still stored", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // Only 2 HubSpot calls: search + create; no association because company has no HS id.
  mockFetchSequence([
    { status: 200, body: { results: [] } },              // deal search
    { status: 200, body: { id: "hs-deal-no-co" } },      // deal POST create
  ]);
  const { id: orgId } = await insertTestOrg({ hubspotCompanyId: null }); // no HS company yet
  const engagementId = await insertTestEngagement(orgId);
  const eventId = await insertGenericEvent({
    kind: "deal.upsert",
    payload: { engagementId, clientOrganizationId: orgId, title: "No-Company Deal", status: "active", startedAt: new Date().toISOString(), summary: null },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "pending", "deal without synced company should remain pending for retry");
    assert.equal(event?.lastError, "company_not_yet_synced");
    // The deal ID must already be stored so the retry patches instead of duplicates.
    const [eng] = await db.select().from(engagementsTable).where(eq(engagementsTable.id, engagementId));
    assert.equal(eng?.hubspotDealId, "hs-deal-no-co", "hubspotDealId should be persisted even when pending");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(engagementsTable).where(eq(engagementsTable.id, engagementId));
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("deal.upsert: association 5xx → event stays pending (retryable), deal ID still stored", async () => {
  const prev = await setSiteHubspotEnabled(true);
  mockFetchSequence([
    { status: 200, body: { results: [] } },           // deal search
    { status: 200, body: { id: "hs-deal-assoc-fail" } }, // deal create
    { status: 500, body: {} },                          // association PUT → transient
  ]);
  const { id: orgId } = await insertTestOrg({ hubspotCompanyId: "hs-company-assoc-test" });
  const engagementId = await insertTestEngagement(orgId);
  const eventId = await insertGenericEvent({
    kind: "deal.upsert",
    payload: { engagementId, clientOrganizationId: orgId, title: "Assoc Fail Deal", status: "active", startedAt: new Date().toISOString(), summary: null },
    attempts: 0,
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "pending", "association 5xx should keep event pending");
    assert.ok(event?.lastError?.includes("assoc_500"), `lastError should mention assoc_500, got: ${event?.lastError}`);
    const [eng] = await db.select().from(engagementsTable).where(eq(engagementsTable.id, engagementId));
    assert.equal(eng?.hubspotDealId, "hs-deal-assoc-fail", "hubspotDealId should be stored despite association failure");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(engagementsTable).where(eq(engagementsTable.id, engagementId));
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("company.upsert: POST 409 CONFLICT → searches existing object and patches it, marks succeeded", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // sequence: search (empty) → POST 409 → deconflict search (found) → PATCH 200
  mockFetchSequence([
    { status: 200, body: { results: [] } },                          // initial search: not found
    { status: 409, body: { status: "error", category: "CONFLICT" } }, // POST: conflict
    { status: 200, body: { results: [{ id: "hs-co-conflict" }] } },  // deconflict search: found
    { status: 200, body: { id: "hs-co-conflict" } },                  // deconflict PATCH
  ]);
  const { id: orgId, slug } = await insertTestOrg();
  const eventId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Conflict Org", slug, approvedEmailDomains: [] },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded", "409 conflict resolution should mark event succeeded");
    const [org] = await db.select().from(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    assert.equal(org?.hubspotCompanyId, "hs-co-conflict", "should store the conflict-resolved Company ID");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("parallel drains for the same org: exactly one Company created even when both POSTs race", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const { id: orgId, slug } = await insertTestOrg();

  // Insert TWO pending events for the same org. Concurrent drains will each
  // claim one via FOR UPDATE SKIP LOCKED.
  const eventId1 = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Race Org", slug, approvedEmailDomains: [] },
  });
  const eventId2 = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Race Org", slug, approvedEmailDomains: [] },
  });

  let postCount = 0;
  // URL-aware mock so we can distinguish search calls from create calls.
  installFetch(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();

    if (url.includes("/search")) {
      // First two searches (one per event's initial lookup) return empty.
      // Any subsequent search is the deconflict search after the 409.
      const results = postCount > 0 ? [{ id: "hs-co-race" }] : [];
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    if (method === "POST") {
      postCount++;
      if (postCount === 1) {
        // First create wins.
        return new Response(JSON.stringify({ id: "hs-co-race" }), { status: 200 });
      }
      // Second create loses — unique property already exists.
      return new Response(JSON.stringify({ status: "error", category: "CONFLICT" }), { status: 409 });
    }
    // PATCH (deconflict or known-ID update)
    return new Response(JSON.stringify({ id: "hs-co-race" }), { status: 200 });
  });

  try {
    // Two concurrent drains — each claims one event via SKIP LOCKED.
    await Promise.all([drainHubspotQueue(1), drainHubspotQueue(1)]);

    const [event1] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId1));
    const [event2] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId2));
    // Both events must resolve to a terminal state (succeeded or pending-for-retry).
    assert.ok(["succeeded", "pending"].includes(event1?.status ?? ""), `event1 status should be succeeded or pending, got ${event1?.status}`);
    assert.ok(["succeeded", "pending"].includes(event2?.status ?? ""), `event2 status should be succeeded or pending, got ${event2?.status}`);

    // Exactly one Company should have been POSTed — the other resolved via PATCH.
    // postCount may be 1 (if second drain skipped search due to known ID) or 2 (true race).
    // In either case the org ends up with one Company ID.
    const [org] = await db.select().from(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    assert.equal(org?.hubspotCompanyId, "hs-co-race", "org must have exactly one Company ID after concurrent drains");
  } finally {
    await cleanupEventById(eventId1);
    await cleanupEventById(eventId2);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("enqueueCompanyUpsert: coalesces into existing pending event instead of inserting a second", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const { id: orgId, slug } = await insertTestOrg();
  try {
    // Enqueue twice — both arrive before any worker claims the event.
    await enqueueCompanyUpsert({ orgId, name: "Org V1", slug, approvedEmailDomains: [] });
    await enqueueCompanyUpsert({ orgId, name: "Org V2", slug, approvedEmailDomains: [] });

    // Only one event should exist in the queue.
    const events = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(
        and(
          eq(hubspotSyncEventsTable.kind, "company.upsert"),
          sql`(payload->>'orgId') = ${orgId}`,
        ),
      );
    assert.equal(events.length, 1, "second enqueue should coalesce into the first pending event, not insert a new row");
    // The payload should carry the latest data.
    const payload = events[0]!.payload as Record<string, unknown>;
    assert.equal(payload["name"], "Org V2", "coalesced event should have the latest payload");
  } finally {
    const events = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(sql`(payload->>'orgId') = ${orgId}`);
    for (const e of events) await cleanupEventById(e.id);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("enqueueCompanyUpsert: inserts a NEW event when existing event is in_flight (does not clobber in-progress payload)", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const { id: orgId, slug } = await insertTestOrg();
  // Manually insert an in_flight event to simulate a worker mid-process.
  const inFlightId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "In-flight Org", slug, approvedEmailDomains: [] },
  });
  await db
    .update(hubspotSyncEventsTable)
    .set({ status: "in_flight" })
    .where(eq(hubspotSyncEventsTable.id, inFlightId));
  try {
    // Enqueue a follow-up update. The in_flight event must NOT be mutated.
    await enqueueCompanyUpsert({ orgId, name: "Updated Org", slug, approvedEmailDomains: [] });

    const events = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(sql`(payload->>'orgId') = ${orgId}`)
      .orderBy(hubspotSyncEventsTable.createdAt);
    assert.equal(events.length, 2, "a new pending event should be inserted alongside the in_flight one");
    const inFlight = events.find((e) => e.id === inFlightId)!;
    assert.equal((inFlight.payload as Record<string, unknown>)["name"], "In-flight Org", "in_flight event payload must NOT be overwritten");
    const newEvent = events.find((e) => e.id !== inFlightId)!;
    assert.equal(newEvent.status, "pending", "new event should be pending");
    assert.equal((newEvent.payload as Record<string, unknown>)["name"], "Updated Org", "new event should carry the latest payload");
  } finally {
    const events = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(sql`(payload->>'orgId') = ${orgId}`);
    for (const e of events) await cleanupEventById(e.id);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("company.upsert: search 5xx → stays pending, never falls through to POST", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // Only one call: search → 500. No POST should follow.
  let callCount = 0;
  installFetch(async () => {
    callCount++;
    return new Response("gateway error", { status: 500 });
  });
  const { id: orgId, slug } = await insertTestOrg();
  const eventId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Test Org", slug, approvedEmailDomains: [] },
    attempts: 0,
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "pending", "search 5xx should leave event pending");
    assert.ok(event?.lastError?.includes("search_500"), `lastError should contain search_500, got: ${event?.lastError}`);
    assert.equal(callCount, 1, "only the search call should be made — no fallthrough POST");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("company.upsert: known hubspotCompanyId → direct PATCH, no search call", async () => {
  const prev = await setSiteHubspotEnabled(true);
  // The org already has a HubSpot ID. We expect exactly one call: PATCH.
  let callCount = 0;
  installFetch(async () => {
    callCount++;
    return new Response(JSON.stringify({ id: "hs-company-known" }), { status: 200 });
  });
  // Org starts with hubspotCompanyId already set (previous successful sync).
  const { id: orgId, slug } = await insertTestOrg({ hubspotCompanyId: "hs-company-known" });
  const eventId = await insertGenericEvent({
    kind: "company.upsert",
    payload: { orgId, name: "Updated Name", slug, approvedEmailDomains: [] },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded", "direct PATCH path should succeed");
    assert.equal(callCount, 1, "only one PATCH call — search must be skipped when ID is known");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("deal.upsert: search 5xx → stays pending, never falls through to POST", async () => {
  const prev = await setSiteHubspotEnabled(true);
  let callCount = 0;
  installFetch(async () => {
    callCount++;
    return new Response("search error", { status: 500 });
  });
  const { id: orgId } = await insertTestOrg({ hubspotCompanyId: "hs-company-search-fail" });
  const engagementId = await insertTestEngagement(orgId);
  const eventId = await insertGenericEvent({
    kind: "deal.upsert",
    payload: { engagementId, clientOrganizationId: orgId, title: "Deal Search Fail", status: "active", startedAt: null, summary: null },
    attempts: 0,
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "pending", "deal search 5xx should leave event pending");
    assert.ok(event?.lastError?.includes("search_500"), `lastError should contain search_500, got: ${event?.lastError}`);
    assert.equal(callCount, 1, "only the search call — no fallthrough POST");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(engagementsTable).where(eq(engagementsTable.id, engagementId));
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("deal.upsert: known hubspotDealId → direct PATCH, skips search", async () => {
  const prev = await setSiteHubspotEnabled(true);
  let callCount = 0;
  installFetch(async (input) => {
    callCount++;
    // Accept both the PATCH and the association PUT.
    return new Response(JSON.stringify({ id: "hs-deal-known" }), { status: 200 });
  });
  const { id: orgId } = await insertTestOrg({ hubspotCompanyId: "hs-company-for-known-deal" });
  const engagementId = await insertTestEngagement(orgId);
  // Pre-set hubspotDealId as if a previous sync already ran.
  await db.update(engagementsTable).set({ hubspotDealId: "hs-deal-known" }).where(eq(engagementsTable.id, engagementId));
  const eventId = await insertGenericEvent({
    kind: "deal.upsert",
    payload: { engagementId, clientOrganizationId: orgId, title: "Updated Deal", status: "active", startedAt: null, summary: null },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "succeeded", "direct PATCH path for deal should succeed");
    // 2 calls: PATCH deal + PUT association (no search).
    assert.equal(callCount, 2, "search must be skipped — only PATCH + association PUT");
  } finally {
    await cleanupEventById(eventId);
    await db.delete(engagementsTable).where(eq(engagementsTable.id, engagementId));
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});

test("deal.upsert: association 403 MISSING_SCOPES → dead_lettered immediately", async () => {
  const prev = await setSiteHubspotEnabled(true);
  mockFetchSequence([
    { status: 200, body: { results: [] } },                // deal search
    { status: 200, body: { id: "hs-deal-scope-fail" } },   // deal create
    { status: 403, body: MISSING_SCOPES_BODY },             // association → scope error
  ]);
  const { id: orgId } = await insertTestOrg({ hubspotCompanyId: "hs-company-scope-test" });
  const engagementId = await insertTestEngagement(orgId);
  const eventId = await insertGenericEvent({
    kind: "deal.upsert",
    payload: { engagementId, clientOrganizationId: orgId, title: "Scope Fail Deal", status: "active", startedAt: new Date().toISOString(), summary: null },
  });
  try {
    await drainHubspotQueue(10);
    const [event] = await db.select().from(hubspotSyncEventsTable).where(eq(hubspotSyncEventsTable.id, eventId));
    assert.equal(event?.status, "dead_letter", "association MISSING_SCOPES should dead-letter immediately");
    assert.ok(event?.lastError?.includes("missing_scope"), `lastError should contain missing_scope, got: ${event?.lastError}`);
  } finally {
    await cleanupEventById(eventId);
    await db.delete(engagementsTable).where(eq(engagementsTable.id, engagementId));
    await db.delete(clientOrganizationsTable).where(eq(clientOrganizationsTable.id, orgId));
    await restoreSiteHubspotEnabled(prev);
  }
});
