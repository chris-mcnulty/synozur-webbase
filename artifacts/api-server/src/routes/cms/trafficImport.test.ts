/**
 * Integration tests for POST /api/cms/traffic/import (#231).
 *
 * The public ingest endpoint (POST /api/traffic/ingest) already has
 * coverage in `traffic.ingest.test.ts`. This file exercises the admin
 * import surface, which is uniquely responsible for:
 *
 *   1. Cookie-based admin auth (instead of the public `tp_*` Bearer key).
 *   2. CSV header → canonical-field mapping via parseCsvAsObjects +
 *      normalizeIngestRow's synonym set (e.g. `session_id`, `timestamp`).
 *   3. Writing a `traffic_property_imports` audit row whose
 *      accepted/duplicates/errors counters reflect the batch outcome.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:traffic-import
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  rolesTable,
  userRoles,
  sessionsTable,
  trafficPropertiesTable,
  trafficPropertyImportsTable,
  trafficSessionsTable,
  trafficPageviewsTable,
} from "@workspace/db";
import app from "../../app";
import { createSession } from "../../lib/sessions";

interface TestContext {
  userId: string;
  cookie: string;
  baseUrl: string;
  server: http.Server;
  propertyId: string;
  propertySlug: string;
}

async function ensureAdminRoleId(): Promise<string> {
  const existing = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.name, "admin"),
  });
  if (existing) return existing.id;
  const [created] = await db
    .insert(rolesTable)
    .values({ name: "admin" })
    .returning({ id: rolesTable.id });
  return created!.id;
}

async function makeAdminUser(tag: string): Promise<string> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `traffic-import-test-${tag}@example.invalid`,
      displayName: "Traffic Import Test Admin",
      authProvider: "test",
      externalSubject: `traffic-import-${tag}`,
    })
    .returning({ id: usersTable.id });
  const roleId = await ensureAdminRoleId();
  await db.insert(userRoles).values({ userId: u!.id, roleId });
  return u!.id;
}

async function setupContext(tag: string): Promise<TestContext> {
  const userId = await makeAdminUser(tag);
  const { token } = await createSession({
    userId,
    userAgent: `traffic-import-test/${tag}`,
    ip: "127.0.0.1",
  });

  const propertySlug = `t-imp-${tag}`;
  const [property] = await db
    .insert(trafficPropertiesTable)
    .values({
      slug: propertySlug,
      name: `Test Import ${tag}`,
      isDefault: false,
      isActive: true,
    })
    .returning({ id: trafficPropertiesTable.id });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const cookie = `sid=${encodeURIComponent(token)}`;

  return {
    userId,
    cookie,
    baseUrl,
    server,
    propertyId: property!.id,
    propertySlug,
  };
}

async function teardownContext(ctx: TestContext): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    ctx.server.close((err) => (err ? reject(err) : resolve())),
  );
  // Pageviews → sessions → import audit rows → property → user session → user.
  await db
    .delete(trafficPageviewsTable)
    .where(eq(trafficPageviewsTable.sourceSystem, ctx.propertySlug));
  await db
    .delete(trafficSessionsTable)
    .where(eq(trafficSessionsTable.sourceSystem, ctx.propertySlug));
  await db
    .delete(trafficPropertyImportsTable)
    .where(eq(trafficPropertyImportsTable.propertyId, ctx.propertyId));
  await db
    .delete(trafficPropertiesTable)
    .where(eq(trafficPropertiesTable.id, ctx.propertyId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, ctx.userId));
  await db.delete(usersTable).where(eq(usersTable.id, ctx.userId));
}

async function postImport(
  ctx: TestContext,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${ctx.baseUrl}/api/cms/traffic/import`, {
    method: "POST",
    headers: { cookie: ctx.cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

test("POST /cms/traffic/import (json) writes pageviews, audit row, and is idempotent", async () => {
  const tag = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const ctx = await setupContext(tag);
  try {
    const sessionKey = `imp-sess-${randomBytes(4).toString("hex")}`;
    const viewedAt = new Date().toISOString();
    const viewedAt2 = new Date(Date.now() + 1000).toISOString();
    const body = {
      propertySlug: ctx.propertySlug,
      kind: "json" as const,
      fileName: "fixture.json",
      pageviews: [
        { sessionKey, path: "/", viewedAt, title: "Home" },
        { sessionKey, path: "/insights", viewedAt: viewedAt2, title: "Insights" },
      ],
    };

    const first = await postImport(ctx, body);
    assert.equal(first.status, 200, `expected 200, got ${first.status}: ${JSON.stringify(first.json)}`);
    assert.equal(first.json.accepted, 2);
    assert.equal(first.json.duplicates, 0);
    assert.equal(first.json.errors, 0);
    assert.equal(first.json.rowsParsed, 2);
    assert.ok(first.json.importId, "importId returned");

    // Rows landed under the chosen propertySlug.
    const sessions = await db
      .select({ id: trafficSessionsTable.id })
      .from(trafficSessionsTable)
      .where(
        and(
          eq(trafficSessionsTable.sourceSystem, ctx.propertySlug),
          eq(trafficSessionsTable.legacySessionKey, sessionKey),
        ),
      );
    assert.equal(sessions.length, 1, "one session row per (slug, sessionKey)");
    const pageviews = await db
      .select({
        id: trafficPageviewsTable.id,
        sourceSystem: trafficPageviewsTable.sourceSystem,
      })
      .from(trafficPageviewsTable)
      .where(eq(trafficPageviewsTable.sessionId, sessions[0]!.id));
    assert.equal(pageviews.length, 2, "two pageview rows from the batch");
    for (const pv of pageviews) {
      assert.equal(
        pv.sourceSystem,
        ctx.propertySlug,
        "pageview row tagged with the chosen propertySlug",
      );
    }

    // Audit row reflects the first run's counters.
    const [audit1] = await db
      .select()
      .from(trafficPropertyImportsTable)
      .where(eq(trafficPropertyImportsTable.id, first.json.importId));
    assert.ok(audit1, "audit row written");
    assert.equal(audit1!.propertyId, ctx.propertyId);
    assert.equal(audit1!.kind, "json");
    assert.equal(audit1!.sourceFile, "fixture.json");
    assert.equal(audit1!.accepted, 2);
    assert.equal(audit1!.duplicates, 0);
    assert.equal(audit1!.errors, 0);
    assert.equal(audit1!.createdBy, ctx.userId);

    // Re-post the same payload: rows must be classified as duplicates,
    // not accepted, and no extra pageview rows are written.
    const second = await postImport(ctx, body);
    assert.equal(second.status, 200);
    assert.equal(second.json.accepted, 0, "no fresh inserts on retry");
    assert.equal(second.json.duplicates, 2, "both rows flagged as duplicates");
    assert.equal(second.json.errors, 0);

    const pageviewsAfter = await db
      .select({ id: trafficPageviewsTable.id })
      .from(trafficPageviewsTable)
      .where(eq(trafficPageviewsTable.sessionId, sessions[0]!.id));
    assert.equal(pageviewsAfter.length, 2, "no double-counted pageviews after retry");

    const [audit2] = await db
      .select()
      .from(trafficPropertyImportsTable)
      .where(eq(trafficPropertyImportsTable.id, second.json.importId));
    assert.ok(audit2);
    assert.equal(audit2!.accepted, 0);
    assert.equal(audit2!.duplicates, 2);
  } finally {
    await teardownContext(ctx);
  }
});

test("POST /cms/traffic/import (csv) maps headers and writes pageviews + audit row", async () => {
  const tag = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}-csv`;
  const ctx = await setupContext(tag);
  try {
    const sessionKey = `imp-csv-${randomBytes(4).toString("hex")}`;
    const ts1 = new Date().toISOString();
    const ts2 = new Date(Date.now() + 2000).toISOString();
    // Use header synonyms (`session_id`, `timestamp`) to exercise the
    // mapping inside normalizeIngestRow. Also include a row with a
    // missing `path` so the errors counter has signal.
    const csv =
      `session_id,path,timestamp,title\n` +
      `${sessionKey},/,${ts1},Home\n` +
      `${sessionKey},/about,${ts2},About\n` +
      `${sessionKey},,${ts2},Bad Row\n`;

    const body = {
      propertySlug: ctx.propertySlug,
      kind: "csv" as const,
      fileName: "fixture.csv",
      csv,
    };

    const first = await postImport(ctx, body);
    assert.equal(first.status, 200, `expected 200, got ${first.status}: ${JSON.stringify(first.json)}`);
    assert.equal(first.json.accepted, 2, "two valid rows accepted");
    assert.equal(first.json.duplicates, 0);
    assert.equal(first.json.errors, 1, "missing-path row counted as an error");
    assert.equal(first.json.rowsParsed, 3);

    const sessions = await db
      .select({ id: trafficSessionsTable.id })
      .from(trafficSessionsTable)
      .where(
        and(
          eq(trafficSessionsTable.sourceSystem, ctx.propertySlug),
          eq(trafficSessionsTable.legacySessionKey, sessionKey),
        ),
      );
    assert.equal(sessions.length, 1);
    const pageviews = await db
      .select({
        id: trafficPageviewsTable.id,
        sourceSystem: trafficPageviewsTable.sourceSystem,
      })
      .from(trafficPageviewsTable)
      .where(eq(trafficPageviewsTable.sessionId, sessions[0]!.id));
    assert.equal(pageviews.length, 2);
    for (const pv of pageviews) {
      assert.equal(pv.sourceSystem, ctx.propertySlug);
    }

    const [audit] = await db
      .select()
      .from(trafficPropertyImportsTable)
      .where(eq(trafficPropertyImportsTable.id, first.json.importId));
    assert.ok(audit);
    assert.equal(audit!.kind, "csv");
    assert.equal(audit!.sourceFile, "fixture.csv");
    assert.equal(audit!.accepted, 2);
    assert.equal(audit!.duplicates, 0);
    assert.equal(audit!.errors, 1);
    assert.ok(audit!.sourceFileSha256, "csv body sha256 captured");

    // Idempotency: re-posting the same CSV should classify the two
    // valid rows as duplicates and not insert new pageviews.
    const second = await postImport(ctx, body);
    assert.equal(second.status, 200);
    assert.equal(second.json.accepted, 0);
    assert.equal(second.json.duplicates, 2);
    // The malformed row still fails to normalize.
    assert.equal(second.json.errors, 1);

    const pageviewsAfter = await db
      .select({ id: trafficPageviewsTable.id })
      .from(trafficPageviewsTable)
      .where(eq(trafficPageviewsTable.sessionId, sessions[0]!.id));
    assert.equal(pageviewsAfter.length, 2, "no extra rows after retry");

    // Second audit row records the duplicate-only retry.
    const [audit2] = await db
      .select()
      .from(trafficPropertyImportsTable)
      .where(eq(trafficPropertyImportsTable.id, second.json.importId));
    assert.ok(audit2, "second audit row written");
    assert.equal(audit2!.kind, "csv");
    assert.equal(audit2!.accepted, 0);
    assert.equal(audit2!.duplicates, 2);
    assert.equal(audit2!.errors, 1);
  } finally {
    await teardownContext(ctx);
  }
});

test("POST /cms/traffic/import requires admin auth (no cookie → 401)", async () => {
  const tag = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}-anon`;
  const ctx = await setupContext(tag);
  try {
    const res = await fetch(`${ctx.baseUrl}/api/cms/traffic/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertySlug: ctx.propertySlug,
        kind: "json",
        pageviews: [],
      }),
    });
    assert.equal(res.status, 401);
  } finally {
    await teardownContext(ctx);
  }
});

test.after(async () => {
  await pool.end();
});
