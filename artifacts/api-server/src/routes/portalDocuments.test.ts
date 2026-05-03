/**
 * Integration tests for the customer Documents surface (#244).
 *
 * Covers two routers:
 *   - routes/portal.ts                 — customer-facing GET /api/portal/documents*
 *   - routes/portalDocumentsAdmin.ts   — admin-facing PATCH/POST under /api/admin/*
 *
 * The Documents feature is a confidentiality risk surface: the published
 * flag, the multi-engagement org scoping, and the audience gate together
 * decide whether a customer can see (or download) a deliverable. Without
 * automated coverage a regression in any of those three could silently
 * leak unpublished or cross-tenant documents to customers.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:portal-documents
 *
 * Like the other route integration tests, this hits the real DATABASE_URL
 * because the route logic IS the SQL. SPE-touching routes (download and
 * reindex) are exercised with method-level stubs on the `speFileStorage`
 * singleton so the Graph calls are deterministic — see the individual
 * tests for the stubbing strategy. The live SPE pipe itself (Graph auth
 * + actual byte streaming) is out of scope; the preview-URL-minting
 * route is also not exercised here.
 */
process.env["EMAIL_DISABLED"] = "1";
// Force the admin guard's allow-list path off so we exercise the
// db-backed `admin` role grant — the production code path.
process.env["ADMIN_EMAILS"] = "no-one@example.invalid";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  rolesTable,
  userRoles,
  sessionsTable,
  clientOrganizationsTable,
  clientOrganizationUsersTable,
  engagementsTable,
  portalDocumentsTable,
  auditLogTable,
} from "@workspace/db";
import app from "../app";
import { createSession } from "../lib/sessions";
import { speFileStorage } from "../lib/storage/spe/fileStorage";

interface TestFixture {
  server: http.Server;
  baseUrl: string;
  // Org A — the "primary" tenant the customer belongs to.
  orgAId: string;
  // Org B — the "other tenant" used for cross-tenant negative tests.
  orgBId: string;
  // Customer in org A.
  customerAUserId: string;
  customerACookie: string;
  // Customer in org B.
  customerBUserId: string;
  customerBCookie: string;
  // Logged in but lacking the `customer` role — exercises the audience
  // gate (403) without needing org membership.
  registeredOnlyUserId: string;
  registeredOnlyCookie: string;
  // Admin (account manager) for the publish/unpublish/reindex tests.
  adminUserId: string;
  adminCookie: string;

  // Engagements in org A and org B.
  engagementAId: string;
  engagementBId: string;
  // Engagement in org A that has no spePath set — exercises the reindex
  // 400 guard.
  engagementANoSpeId: string;

  // Documents under engagement A.
  publishedDocAId: string;
  unpublishedDocAId: string;
  // Second unpublished row used by the unpublish-flow test so it
  // doesn't depend on the publish test having run first.
  publishedDocAToUnpublishId: string;
  softDeletedDocAId: string;
  // Document under engagement B (used for cross-tenant tests).
  publishedDocBId: string;

  startedAt: Date;
}

async function ensureRoleId(name: "admin" | "customer" | "registered"): Promise<string> {
  const existing = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.name, name),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(rolesTable)
    .values({ name })
    .returning({ id: rolesTable.id });
  return created.id;
}

async function makeUser(opts: {
  tag: string;
  label: string;
  roles: Array<"admin" | "customer" | "registered">;
  clientOrganizationId: string | null;
}): Promise<{ id: string; cookie: string }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `portal-docs-${opts.label}-${opts.tag}@example.invalid`,
      displayName: `Portal Docs ${opts.label}`,
      authProvider: "test",
      externalSubject: `portal-docs-${opts.label}-${opts.tag}`,
      clientOrganizationId: opts.clientOrganizationId,
    })
    .returning({ id: usersTable.id });
  for (const roleName of opts.roles) {
    const roleId = await ensureRoleId(roleName);
    await db.insert(userRoles).values({ userId: u.id, roleId }).onConflictDoNothing();
  }
  const { token } = await createSession({
    userId: u.id,
    userAgent: `portal-docs-test/${opts.tag}`,
    ip: "127.0.0.1",
  });
  return { id: u.id, cookie: `sid=${encodeURIComponent(token)}` };
}

async function setup(): Promise<TestFixture> {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();

  const [orgA] = await db
    .insert(clientOrganizationsTable)
    .values({ name: `Portal Docs Test Org A ${tag}`, slug: `portal-docs-a-${tag}` })
    .returning({ id: clientOrganizationsTable.id });
  const [orgB] = await db
    .insert(clientOrganizationsTable)
    .values({ name: `Portal Docs Test Org B ${tag}`, slug: `portal-docs-b-${tag}` })
    .returning({ id: clientOrganizationsTable.id });

  const customerA = await makeUser({
    tag,
    label: "customerA",
    roles: ["customer"],
    clientOrganizationId: orgA.id,
  });
  await db
    .insert(clientOrganizationUsersTable)
    .values({ userId: customerA.id, clientOrganizationId: orgA.id, role: "member" });

  const customerB = await makeUser({
    tag,
    label: "customerB",
    roles: ["customer"],
    clientOrganizationId: orgB.id,
  });
  await db
    .insert(clientOrganizationUsersTable)
    .values({ userId: customerB.id, clientOrganizationId: orgB.id, role: "member" });

  // No client org membership and no `customer` role — only `registered`.
  // The audience gate must reject this user with 403.
  const registeredOnly = await makeUser({
    tag,
    label: "registered",
    roles: ["registered"],
    clientOrganizationId: null,
  });

  const admin = await makeUser({
    tag,
    label: "admin",
    roles: ["admin"],
    clientOrganizationId: null,
  });

  const [engA] = await db
    .insert(engagementsTable)
    .values({
      clientOrganizationId: orgA.id,
      title: `Engagement A ${tag}`,
      slug: `engagement-a-${tag}`,
      spePath: `/test/engagements/a-${tag}`,
    })
    .returning({ id: engagementsTable.id });
  const [engB] = await db
    .insert(engagementsTable)
    .values({
      clientOrganizationId: orgB.id,
      title: `Engagement B ${tag}`,
      slug: `engagement-b-${tag}`,
      spePath: `/test/engagements/b-${tag}`,
    })
    .returning({ id: engagementsTable.id });
  const [engANoSpe] = await db
    .insert(engagementsTable)
    .values({
      clientOrganizationId: orgA.id,
      title: `Engagement A no-spe ${tag}`,
      slug: `engagement-a-nospe-${tag}`,
    })
    .returning({ id: engagementsTable.id });

  // Three rows for engagement A — one published, one indexed-but-unpublished,
  // one soft-deleted-but-formerly-published. Customer A must see only the
  // first one.
  const now = new Date();
  const [pubDocA] = await db
    .insert(portalDocumentsTable)
    .values({
      engagementId: engA.id,
      spePath: `/test/engagements/a-${tag}`,
      spaceItemId: `spe-a-pub-${tag}`,
      filename: "published-a.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      lastModifiedAt: now,
      publishedAt: now,
      indexedAt: now,
    })
    .returning({ id: portalDocumentsTable.id });
  const [unpubDocA] = await db
    .insert(portalDocumentsTable)
    .values({
      engagementId: engA.id,
      spePath: `/test/engagements/a-${tag}`,
      spaceItemId: `spe-a-unpub-${tag}`,
      filename: "draft-a.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
      lastModifiedAt: now,
      publishedAt: null,
      indexedAt: now,
    })
    .returning({ id: portalDocumentsTable.id });
  // Independent published row consumed by the unpublish-flow test.
  // Keeping a dedicated fixture per write-flow test means the order in
  // which the suite runs them doesn't matter.
  const [pubDocAToUnpublish] = await db
    .insert(portalDocumentsTable)
    .values({
      engagementId: engA.id,
      spePath: `/test/engagements/a-${tag}`,
      spaceItemId: `spe-a-pub-unpub-${tag}`,
      filename: "to-unpublish-a.pdf",
      contentType: "application/pdf",
      sizeBytes: 1500,
      lastModifiedAt: now,
      publishedAt: now,
      publishedBy: null,
      indexedAt: now,
    })
    .returning({ id: portalDocumentsTable.id });
  const [delDocA] = await db
    .insert(portalDocumentsTable)
    .values({
      engagementId: engA.id,
      spePath: `/test/engagements/a-${tag}`,
      spaceItemId: `spe-a-deleted-${tag}`,
      filename: "deleted-a.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
      lastModifiedAt: now,
      publishedAt: now,
      deletedAt: now,
      indexedAt: now,
    })
    .returning({ id: portalDocumentsTable.id });

  const [pubDocB] = await db
    .insert(portalDocumentsTable)
    .values({
      engagementId: engB.id,
      spePath: `/test/engagements/b-${tag}`,
      spaceItemId: `spe-b-pub-${tag}`,
      filename: "published-b.pdf",
      contentType: "application/pdf",
      sizeBytes: 4096,
      lastModifiedAt: now,
      publishedAt: now,
      indexedAt: now,
    })
    .returning({ id: portalDocumentsTable.id });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    server,
    baseUrl,
    orgAId: orgA.id,
    orgBId: orgB.id,
    customerAUserId: customerA.id,
    customerACookie: customerA.cookie,
    customerBUserId: customerB.id,
    customerBCookie: customerB.cookie,
    registeredOnlyUserId: registeredOnly.id,
    registeredOnlyCookie: registeredOnly.cookie,
    adminUserId: admin.id,
    adminCookie: admin.cookie,
    engagementAId: engA.id,
    engagementBId: engB.id,
    engagementANoSpeId: engANoSpe.id,
    publishedDocAId: pubDocA.id,
    unpublishedDocAId: unpubDocA.id,
    publishedDocAToUnpublishId: pubDocAToUnpublish.id,
    softDeletedDocAId: delDocA.id,
    publishedDocBId: pubDocB.id,
    startedAt,
  };
}

async function teardown(fx: TestFixture): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    fx.server.close((err) => (err ? reject(err) : resolve())),
  );
  // Audit rows reference the actor users we're about to delete; clean
  // those from this run first.
  await db
    .delete(auditLogTable)
    .where(
      and(
        gte(auditLogTable.at, fx.startedAt),
        inArray(auditLogTable.actorId, [fx.adminUserId, fx.customerAUserId]),
      ),
    );
  await db
    .delete(portalDocumentsTable)
    .where(
      inArray(portalDocumentsTable.engagementId, [
        fx.engagementAId,
        fx.engagementBId,
        fx.engagementANoSpeId,
      ]),
    );
  await db
    .delete(engagementsTable)
    .where(
      inArray(engagementsTable.id, [
        fx.engagementAId,
        fx.engagementBId,
        fx.engagementANoSpeId,
      ]),
    );
  const userIds = [
    fx.customerAUserId,
    fx.customerBUserId,
    fx.registeredOnlyUserId,
    fx.adminUserId,
  ];
  await db
    .delete(clientOrganizationUsersTable)
    .where(inArray(clientOrganizationUsersTable.userId, userIds));
  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db
    .delete(clientOrganizationsTable)
    .where(inArray(clientOrganizationsTable.id, [fx.orgAId, fx.orgBId]));
}

let fx: TestFixture;

test.before(async () => {
  fx = await setup();
});

test.after(async () => {
  if (fx) await teardown(fx);
  await pool.end();
});

// ---------------------------------------------------------------------------
// Customer-facing portal routes (auth gating + scoping + publish gate)
// ---------------------------------------------------------------------------

test("GET /api/portal/documents returns 401 without a session", async () => {
  const res = await fetch(`${fx.baseUrl}/api/portal/documents`);
  assert.equal(res.status, 401);
});

test("GET /api/portal/documents returns 403 for a signed-in non-customer", async () => {
  const res = await fetch(`${fx.baseUrl}/api/portal/documents`, {
    headers: { cookie: fx.registeredOnlyCookie },
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { reason?: string };
  // The audience middleware emits a machine-readable reason — make sure
  // the contract the SPA depends on doesn't drift.
  assert.equal(body.reason, "not_a_customer");
});

test("GET /api/portal/documents lists only published docs for the user's org", async () => {
  const res = await fetch(`${fx.baseUrl}/api/portal/documents`, {
    headers: { cookie: fx.customerACookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    items: Array<{ id: string; engagementId: string; filename: string }>;
  };
  const ids = body.items.map((i) => i.id).sort();
  // Must include the published doc in org A...
  assert.ok(
    ids.includes(fx.publishedDocAId),
    `expected published doc in list, got ${ids.join(",")}`,
  );
  // ...and must NOT include the unpublished, soft-deleted, or other-tenant rows.
  assert.ok(
    !ids.includes(fx.unpublishedDocAId),
    "unpublished doc must not appear in the customer list",
  );
  assert.ok(
    !ids.includes(fx.softDeletedDocAId),
    "soft-deleted doc must not appear in the customer list",
  );
  assert.ok(
    !ids.includes(fx.publishedDocBId),
    "another tenant's doc must not appear in the customer list",
  );
});

test("GET /api/portal/documents?engagementId scopes to the requested engagement only", async () => {
  // Asking for engagement B's documents while signed in as customer A
  // must NOT leak anything — the org filter still applies.
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents?engagementId=${fx.engagementBId}`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ id: string }> };
  assert.deepEqual(
    body.items.map((i) => i.id),
    [],
    "engagementId filter must not bypass the client-org scope",
  );
});

test("GET /api/portal/documents/:id returns 404 for an unpublished doc", async () => {
  // Customer A trying to fetch the indexed-but-not-yet-published row.
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.unpublishedDocAId}`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 404);
});

test("GET /api/portal/documents/:id returns 404 for a soft-deleted doc", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.softDeletedDocAId}`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 404);
});

test("GET /api/portal/documents/:id returns 404 for another tenant's doc", async () => {
  // Customer A enumerating org B's published doc id directly.
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.publishedDocBId}`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 404);
});

test("GET /api/portal/documents/:id returns 200 for the customer's own published doc", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.publishedDocAId}`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    id: string;
    engagementId: string;
    filename: string;
    publishedAt: string | null;
  };
  assert.equal(body.id, fx.publishedDocAId);
  assert.equal(body.engagementId, fx.engagementAId);
  assert.equal(body.filename, "published-a.pdf");
  assert.ok(body.publishedAt, "published doc should expose a publishedAt timestamp");
});

test("GET /api/portal/documents/:id/content returns 401 without a session", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.publishedDocAId}/content`,
  );
  assert.equal(res.status, 401);
});

test("GET /api/portal/documents/:id/content returns 403 for a non-customer signed-in user", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.publishedDocAId}/content`,
    { headers: { cookie: fx.registeredOnlyCookie } },
  );
  assert.equal(res.status, 403);
});

test("GET /api/portal/documents/:id/content returns 403 for an unpublished doc", async () => {
  // Download denial contract (#244): a signed-in customer in the
  // customer audience who hits a real document id they aren't
  // entitled to gets a 403. The metadata `/:id` route returns 404
  // for the same conditions (anti-enumeration), but the download
  // route is the gate audit logs as `portal_document.download` and
  // distinguishes "forbidden" from "no such id" explicitly.
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.unpublishedDocAId}/content`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 403);
});

test("GET /api/portal/documents/:id/content returns 403 for another tenant's doc", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.publishedDocBId}/content`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 403);
});

test("GET /api/portal/documents/:id/content returns 404 for a soft-deleted doc", async () => {
  // Soft-deleted rows are tombstones — neither customers nor admins
  // see them anywhere. The download route returns 404 (not 403) for
  // these to match the unknown-id case: the row effectively does
  // not exist from the customer's perspective. The 403 contract
  // applies to live rows the customer isn't entitled to.
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/${fx.softDeletedDocAId}/content`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 404);
});

test("GET /api/portal/documents/:id/content returns 404 for a non-existent doc id", async () => {
  // Sanity: the 403 contract above is for *real* document ids the
  // customer isn't entitled to. A made-up uuid still 404s.
  const res = await fetch(
    `${fx.baseUrl}/api/portal/documents/00000000-0000-0000-0000-000000000000/content`,
    { headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 404);
});

test("GET /api/portal/documents/:id/content streams the file for an entitled customer", async () => {
  // Happy-path download with SPE stubbed. Verifies the entitled
  // customer reaches the SPE pipe and receives the bytes with the
  // expected attachment headers — i.e. the denial gates above
  // really are gates (entitled callers do get through).
  const originalGetFile = speFileStorage.getFile.bind(speFileStorage);
  const expectedBody = "stub-pdf-bytes-" + Date.now();
  (speFileStorage as unknown as {
    getFile: (id: string) => Promise<Response>;
  }).getFile = async () =>
    new Response(expectedBody, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(expectedBody.length),
      },
    });
  try {
    const res = await fetch(
      `${fx.baseUrl}/api/portal/documents/${fx.publishedDocAId}/content`,
      { headers: { cookie: fx.customerACookie } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    const disp = res.headers.get("content-disposition");
    assert.ok(
      disp && disp.startsWith("attachment;"),
      `expected attachment disposition, got ${disp}`,
    );
    assert.match(disp!, /published-a\.pdf/);
    const body = await res.text();
    assert.equal(body, expectedBody);
  } finally {
    (speFileStorage as unknown as {
      getFile: (id: string) => Promise<Response>;
    }).getFile = originalGetFile;
  }
});

// ---------------------------------------------------------------------------
// Admin-facing portalDocumentsAdmin routes (spePath, reindex, publish toggle)
// ---------------------------------------------------------------------------

test("admin routes reject anonymous requests with 401", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/admin/portal-documents/${fx.publishedDocAId}/publish`,
    { method: "POST" },
  );
  assert.equal(res.status, 401);
});

test("admin routes reject signed-in non-admins with 403", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/admin/portal-documents/${fx.publishedDocAId}/publish`,
    { method: "POST", headers: { cookie: fx.customerACookie } },
  );
  assert.equal(res.status, 403);
});

test("PATCH /api/admin/engagements/:id sets spePath and emits an audit row", async () => {
  const newPath = `/test/engagements/a-no-spe-${Date.now()}`;
  const res = await fetch(
    `${fx.baseUrl}/api/admin/engagements/${fx.engagementANoSpeId}`,
    {
      method: "PATCH",
      headers: {
        cookie: fx.adminCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ spePath: newPath }),
    },
  );
  assert.equal(res.status, 204);

  const row = await db.query.engagementsTable.findFirst({
    where: eq(engagementsTable.id, fx.engagementANoSpeId),
  });
  assert.equal(row?.spePath, newPath, "spePath should be persisted");

  const auditRows = await db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.entity, "engagement"),
        eq(auditLogTable.entityId, fx.engagementANoSpeId),
        eq(auditLogTable.action, "engagement.update_spe_path"),
      ),
    )
    .orderBy(desc(auditLogTable.at));
  assert.ok(auditRows.length >= 1, "expected an audit row for the spePath update");
  assert.equal(auditRows[0].actorId, fx.adminUserId);
});

test("PATCH /api/admin/engagements/:id rejects an invalid body", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/admin/engagements/${fx.engagementANoSpeId}`,
    {
      method: "PATCH",
      headers: {
        cookie: fx.adminCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ spePath: 42 }),
    },
  );
  assert.equal(res.status, 400);
});

test("POST reindex-documents returns 400 when spePath is unset", async () => {
  // Wipe the spePath we set in the previous test so we exercise the
  // "no folder configured" guard. This tests the explicit-failure
  // contract without needing a live SPE container.
  await db
    .update(engagementsTable)
    .set({ spePath: null })
    .where(eq(engagementsTable.id, fx.engagementANoSpeId));
  const res = await fetch(
    `${fx.baseUrl}/api/admin/engagements/${fx.engagementANoSpeId}/reindex-documents`,
    { method: "POST", headers: { cookie: fx.adminCookie } },
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /spePath|SPE/);
});

test("POST publish stamps publishedAt + publishedBy and emits an audit row", async () => {
  const res = await fetch(
    `${fx.baseUrl}/api/admin/portal-documents/${fx.unpublishedDocAId}/publish`,
    { method: "POST", headers: { cookie: fx.adminCookie } },
  );
  assert.equal(res.status, 204);

  const row = await db.query.portalDocumentsTable.findFirst({
    where: eq(portalDocumentsTable.id, fx.unpublishedDocAId),
  });
  assert.ok(row, "unpublished doc row should still exist after publish");
  assert.ok(row!.publishedAt, "publishedAt should be set after publish");
  assert.equal(row!.publishedBy, fx.adminUserId, "publishedBy should be the admin");

  const auditRows = await db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.entity, "portal_document"),
        eq(auditLogTable.entityId, fx.unpublishedDocAId),
        eq(auditLogTable.action, "portal_document.publish"),
      ),
    );
  assert.ok(auditRows.length >= 1, "expected audit row for publish");

  // After publishing, the customer list should pick the row up — the
  // visibility gate is governed entirely by `publishedAt IS NOT NULL`.
  const listRes = await fetch(`${fx.baseUrl}/api/portal/documents`, {
    headers: { cookie: fx.customerACookie },
  });
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { items: Array<{ id: string }> };
  assert.ok(
    list.items.some((i) => i.id === fx.unpublishedDocAId),
    "newly published doc should appear in the customer list",
  );
});

test("POST unpublish clears publishedAt + publishedBy and emits an audit row", async () => {
  // Uses a dedicated published fixture (not the one mutated by the
  // publish test) so this test passes independently of run order.
  const target = fx.publishedDocAToUnpublishId;
  // Sanity: the row really is published before we call unpublish.
  const before = await db.query.portalDocumentsTable.findFirst({
    where: eq(portalDocumentsTable.id, target),
  });
  assert.ok(before?.publishedAt, "fixture should start published");

  const res = await fetch(
    `${fx.baseUrl}/api/admin/portal-documents/${target}/unpublish`,
    { method: "POST", headers: { cookie: fx.adminCookie } },
  );
  assert.equal(res.status, 204);

  const row = await db.query.portalDocumentsTable.findFirst({
    where: eq(portalDocumentsTable.id, target),
  });
  assert.ok(row, "row should still exist after unpublish");
  assert.equal(row!.publishedAt, null, "publishedAt should be cleared");
  assert.equal(row!.publishedBy, null, "publishedBy should be cleared");

  const auditRows = await db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.entity, "portal_document"),
        eq(auditLogTable.entityId, target),
        eq(auditLogTable.action, "portal_document.unpublish"),
      ),
    );
  assert.ok(auditRows.length >= 1, "expected audit row for unpublish");

  // And the customer list should drop it.
  const listRes = await fetch(`${fx.baseUrl}/api/portal/documents`, {
    headers: { cookie: fx.customerACookie },
  });
  const list = (await listRes.json()) as { items: Array<{ id: string }> };
  assert.ok(
    !list.items.some((i) => i.id === target),
    "unpublished doc should disappear from the customer list",
  );
});

test("POST reindex-documents walks SPE and persists rows, audits, returns counts", async () => {
  // Use the no-spe engagement: set its spePath, stub the SPE
  // dependencies so the indexer's Graph calls are deterministic, then
  // hit the route. Verifies the success payload, the persisted
  // `portal_documents` rows, and that an audit entry is written.
  const targetEngagement = fx.engagementANoSpeId;
  const indexedSpePath = `/test/engagements/reindex-${Date.now()}`;
  await db
    .update(engagementsTable)
    .set({ spePath: indexedSpePath })
    .where(eq(engagementsTable.id, targetEngagement));

  // Patch the singleton's methods. The indexer only touches
  // `resolveContainerId()` and `graphClient().listChildren()`, so a
  // minimal stub is enough.
  const originalResolve = speFileStorage.resolveContainerId.bind(speFileStorage);
  const originalGraph = speFileStorage.graphClient.bind(speFileStorage);
  const stubItems = [
    {
      id: `stub-item-1-${Date.now()}`,
      name: "stub-deliverable.pdf",
      size: 1234,
      contentType: "application/pdf",
      kind: "file" as const,
      lastModifiedDateTime: new Date().toISOString(),
      webUrl: "https://example.invalid/stub-1",
    },
    {
      id: `stub-item-2-${Date.now()}`,
      name: "stub-notes.docx",
      size: 567,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      kind: "file" as const,
      lastModifiedDateTime: new Date().toISOString(),
      webUrl: "https://example.invalid/stub-2",
    },
  ];
  (speFileStorage as unknown as {
    resolveContainerId: () => Promise<string>;
  }).resolveContainerId = async () => "stub-container-id";
  (speFileStorage as unknown as {
    graphClient: () => unknown;
  }).graphClient = () => ({
    listChildren: async (_containerId: string, _folder: string) => stubItems,
  });

  try {
    const res = await fetch(
      `${fx.baseUrl}/api/admin/engagements/${targetEngagement}/reindex-documents`,
      { method: "POST", headers: { cookie: fx.adminCookie } },
    );
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = (await res.json()) as {
      engagementId: string;
      spePath: string;
      added: number;
      updated: number;
      removed: number;
      totalIndexed: number;
    };
    assert.equal(body.engagementId, targetEngagement);
    assert.equal(body.spePath, indexedSpePath);
    assert.equal(body.totalIndexed, stubItems.length);
    assert.equal(body.added, stubItems.length, "all stub items should be new rows");
    assert.equal(body.updated, 0);
    assert.equal(body.removed, 0);

    // Persisted rows should match the stub items, and crucially
    // `publishedAt` is left null so the indexer never makes a file
    // visible to clients on its own.
    const rows = await db
      .select()
      .from(portalDocumentsTable)
      .where(eq(portalDocumentsTable.engagementId, targetEngagement));
    assert.equal(rows.length, stubItems.length);
    for (const row of rows) {
      assert.equal(
        row.publishedAt,
        null,
        "indexer must not publish on the customer's behalf",
      );
      assert.equal(row.spePath, indexedSpePath);
    }
    const filenames = rows.map((r) => r.filename).sort();
    assert.deepEqual(
      filenames,
      stubItems.map((i) => i.name).sort(),
      "indexed filenames should mirror what SPE returned",
    );

    // Audit emission so the account team can reconstruct who triggered
    // the reindex and what changed.
    const auditRows = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.entity, "engagement"),
          eq(auditLogTable.entityId, targetEngagement),
          eq(auditLogTable.action, "portal_document.reindex"),
        ),
      );
    assert.ok(auditRows.length >= 1, "expected audit row for reindex");
    assert.equal(auditRows[0].actorId, fx.adminUserId);
  } finally {
    (speFileStorage as unknown as {
      resolveContainerId: () => Promise<string>;
    }).resolveContainerId = originalResolve;
    (speFileStorage as unknown as { graphClient: () => unknown }).graphClient =
      originalGraph;
  }
});

test("POST publish on a non-existent doc returns 404", async () => {
  // 00000000-0000-0000-0000-000000000000 is a valid uuid format but
  // never assigned by defaultRandom().
  const res = await fetch(
    `${fx.baseUrl}/api/admin/portal-documents/00000000-0000-0000-0000-000000000000/publish`,
    { method: "POST", headers: { cookie: fx.adminCookie } },
  );
  assert.equal(res.status, 404);
});
