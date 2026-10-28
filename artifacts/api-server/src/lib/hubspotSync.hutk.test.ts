/**
 * Tests for the hutk → Forms API stitching path inside drainHubspotQueue /
 * processOne (hubspotSync.ts).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:hubspot-hutk
 *
 * Covers:
 *   - When a contact.upsert row carries `synozur_hubspotutk` AND
 *     HUBSPOT_PORTAL_ID + HUBSPOT_FORM_GUID_CONTACT env vars are set,
 *     drainHubspotQueue POSTs to the HubSpot Forms API with the hutk value
 *     in the request body context.
 *   - When `synozur_hubspotutk` is absent, no Forms API call is made.
 *   - When HUBSPOT_PORTAL_ID is missing, stitching is skipped (no Forms API
 *     call) but the row still succeeds via the CRM upsert.
 *   - When HUBSPOT_FORM_GUID_CONTACT is missing, stitching is skipped.
 *   - The hutk value forwarded to the Forms API matches the one stored on the
 *     contact.upsert row — confirms end-to-end propagation.
 *
 * The real DB is used (same pattern as hubspotSync.test.ts).
 * All outbound HTTP is intercepted via globalThis.fetch.
 */

// Must happen before any module load that reads these at import time.
delete process.env["REPLIT_CONNECTORS_HOSTNAME"];
process.env["HUBSPOT_ACCESS_TOKEN"] = "hs-hutk-test-token";
process.env["EMAIL_DISABLED"] = "1";
// Set portal + form-GUID env vars for the stitching path.
// Individual tests override or delete these as needed.
process.env["HUBSPOT_PORTAL_ID"] = "99999";
process.env["HUBSPOT_FORM_GUID_CONTACT"] = "form-guid-contact-test";

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  hubspotSyncEventsTable,
  siteSettingsTable,
} from "@workspace/db";
import { drainHubspotQueue } from "./hubspotSync.js";
import type { ContactProperties } from "./hubspotSync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(tag: string): string {
  return `hutk-test-${tag}-${crypto.randomBytes(4).toString("hex")}@example.invalid`;
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

/**
 * Insert a contact.upsert sync event with the given hutk (or none).
 * The payload mirrors what enqueueContactSubmission writes.
 */
async function insertContactUpsert(opts: {
  email: string;
  hutk?: string;
}): Promise<string> {
  const properties: ContactProperties = {
    email: opts.email,
    firstname: "Test",
    lifecyclestage: "lead",
    synozur_form_type: "contact",
    synozur_marketing_opt_in: "true",
    ...(opts.hutk ? { synozur_hubspotutk: opts.hutk } : {}),
  };
  const [row] = await db
    .insert(hubspotSyncEventsTable)
    .values({
      kind: "contact.upsert",
      contactEmail: opts.email,
      payload: {
        submissionId: 1,
        formType: "contact",
        properties,
      },
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    .returning();
  return row!.id;
}

// ---------------------------------------------------------------------------
// Fetch stub infrastructure
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[] = [];
type FetchLike = typeof globalThis.fetch;
let savedFetch: FetchLike;

/**
 * Install a fetch stub that records every call and returns CRM-upsert 200
 * for api.hubapi.com paths and Forms API 200 for api.hsforms.com paths.
 */
function installMultiPathFetch(opts: {
  crmStatus?: number;
  formsStatus?: number;
} = {}): void {
  fetchCalls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    fetchCalls.push({ url, init: init ?? {} });
    const isFormsApi = url.includes("api.hsforms.com");
    const status = isFormsApi
      ? (opts.formsStatus ?? 200)
      : (opts.crmStatus ?? 200);
    const body = isFormsApi
      ? JSON.stringify({ inlineMessage: "Thanks" })
      : JSON.stringify({ id: "hs-crm-001" });
    return new Response(body, { status });
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test.before(() => {
  savedFetch = globalThis.fetch;
});

test.after(async () => {
  globalThis.fetch = savedFetch;
  await pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("stitching: POSTs to HubSpot Forms API when hutk + env vars are present", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("stitch-ok");
  const hutk = "stitch-token-abc";
  installMultiPathFetch();

  const id = await insertContactUpsert({ email, hutk });
  try {
    await drainHubspotQueue(10);

    // Verify the row succeeded.
    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "contact.upsert row should be succeeded");

    // Exactly one call to the Forms API.
    const formsCalls = fetchCalls.filter((c) => c.url.includes("api.hsforms.com"));
    assert.equal(formsCalls.length, 1, "exactly one Forms API call should be made");

    // The Forms API call URL must embed the portal ID and form GUID.
    const formsUrl = formsCalls[0]!.url;
    assert.ok(
      formsUrl.includes("99999"),
      `Forms API URL should contain portal ID; got: ${formsUrl}`,
    );
    assert.ok(
      formsUrl.includes("form-guid-contact-test"),
      `Forms API URL should contain form GUID; got: ${formsUrl}`,
    );

    // The request body must carry the hutk in the `context` object.
    const body = JSON.parse(formsCalls[0]!.init.body as string) as {
      context?: { hutk?: string };
    };
    assert.equal(
      body.context?.hutk,
      hutk,
      "hutk forwarded to Forms API context must match the stored cookie value",
    );
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("stitching: no Forms API call when synozur_hubspotutk is absent", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("stitch-no-hutk");
  installMultiPathFetch();

  const id = await insertContactUpsert({ email }); // no hutk
  try {
    await drainHubspotQueue(10);

    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "row should still succeed without hutk");

    const formsCalls = fetchCalls.filter((c) => c.url.includes("api.hsforms.com"));
    assert.equal(formsCalls.length, 0, "no Forms API call should be made when hutk is absent");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("stitching: no Forms API call when HUBSPOT_PORTAL_ID is missing", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("stitch-no-portal");
  installMultiPathFetch();

  const savedPortalId = process.env["HUBSPOT_PORTAL_ID"];
  delete process.env["HUBSPOT_PORTAL_ID"];

  const id = await insertContactUpsert({ email, hutk: "token-no-portal" });
  try {
    await drainHubspotQueue(10);

    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "row should still succeed via CRM upsert");

    const formsCalls = fetchCalls.filter((c) => c.url.includes("api.hsforms.com"));
    assert.equal(formsCalls.length, 0, "no Forms API call when HUBSPOT_PORTAL_ID is missing");
  } finally {
    process.env["HUBSPOT_PORTAL_ID"] = savedPortalId ?? "";
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("stitching: no Forms API call when HUBSPOT_FORM_GUID_CONTACT is missing", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("stitch-no-guid");
  installMultiPathFetch();

  const savedGuid = process.env["HUBSPOT_FORM_GUID_CONTACT"];
  delete process.env["HUBSPOT_FORM_GUID_CONTACT"];

  const id = await insertContactUpsert({ email, hutk: "token-no-guid" });
  try {
    await drainHubspotQueue(10);

    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(row?.status, "succeeded", "row should still succeed via CRM upsert");

    const formsCalls = fetchCalls.filter((c) => c.url.includes("api.hsforms.com"));
    assert.equal(formsCalls.length, 0, "no Forms API call when form GUID is missing");
  } finally {
    process.env["HUBSPOT_FORM_GUID_CONTACT"] = savedGuid ?? "";
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});

test("stitching: Forms API failure is non-fatal — CRM upsert row still succeeds", async () => {
  const prev = await setSiteHubspotEnabled(true);
  const email = uniqueEmail("stitch-forms-fail");
  installMultiPathFetch({ formsStatus: 400 });

  const id = await insertContactUpsert({ email, hutk: "token-forms-fail" });
  try {
    await drainHubspotQueue(10);

    const [row] = await db
      .select()
      .from(hubspotSyncEventsTable)
      .where(eq(hubspotSyncEventsTable.id, id));
    assert.equal(
      row?.status,
      "succeeded",
      "CRM upsert row should still succeed even when Forms API returns an error",
    );

    const formsCalls = fetchCalls.filter((c) => c.url.includes("api.hsforms.com"));
    assert.equal(formsCalls.length, 1, "Forms API call was attempted");
  } finally {
    await restoreSiteHubspotEnabled(prev);
    await cleanupEvents([email]);
  }
});
