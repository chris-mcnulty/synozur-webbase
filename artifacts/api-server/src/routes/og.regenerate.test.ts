/**
 * Integration tests for POST /api/og/regenerate.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-regenerate
 *
 * Covers the auth gate, body validation, 404 path, and success paths
 * (with and without `prerender`). The cache-write failure path (502)
 * is not exercised by this file because forcing a GCS error requires
 * either a configured-but-broken `PRIVATE_OBJECT_DIR` or process-wide
 * monkey-patching of the storage client; we instead rely on the
 * structured `CacheWriteResult` / `CacheClearResult` shapes which are
 * unit-readable from the helpers.
 *
 * Like the other route integration tests, this hits the real
 * `DATABASE_URL`. Each run picks unique tags so it is safe to
 * parallelize.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  postsTable,
  usersTable,
  rolesTable,
  userRoles,
  sessionsTable,
} from "@workspace/db";
import app from "../app";
import { createSession } from "../lib/sessions";

let server: http.Server;
let baseUrl: string;

const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const slug = `og-regen-test-${tag}`;
let postId: string | null = null;
let adminUserId: string | null = null;
let registeredUserId: string | null = null;
let createdAuthorId: string | null = null;
let adminCookie = "";
let registeredCookie = "";

async function ensureRoleId(name: "admin" | "registered" | "editor"): Promise<string> {
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
  label: string;
  roles: Array<"admin" | "registered" | "editor">;
}): Promise<{ id: string; cookie: string }> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `og-regen-${opts.label}-${tag}@example.invalid`,
      displayName: `OG Regen ${opts.label}`,
      authProvider: "test",
      externalSubject: `og-regen-${opts.label}-${tag}`,
    })
    .returning({ id: usersTable.id });
  for (const roleName of opts.roles) {
    const roleId = await ensureRoleId(roleName);
    await db
      .insert(userRoles)
      .values({ userId: u.id, roleId })
      .onConflictDoNothing();
  }
  const { token } = await createSession({
    userId: u.id,
    userAgent: `og-regen-test/${tag}`,
    ip: "127.0.0.1",
  });
  return { id: u.id, cookie: `sid=${encodeURIComponent(token)}` };
}

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Author for the test post: reuse an existing user if any, otherwise
  // create one and remember to clean it up.
  const existing = await db.select().from(usersTable).limit(1);
  let authorId: string;
  if (existing.length > 0) {
    authorId = existing[0].id;
  } else {
    const [u] = await db
      .insert(usersTable)
      .values({
        email: `og-regen-author-${tag}@example.invalid`,
        displayName: "OG Regen Author",
      })
      .returning();
    authorId = u.id;
    createdAuthorId = u.id;
  }

  const [post] = await db
    .insert(postsTable)
    .values({
      slug,
      title: "OG regen test post",
      authorId,
      status: "published",
      publishedAt: new Date(Date.now() - 60_000),
    })
    .returning();
  postId = post.id;

  const admin = await makeUser({ label: "admin", roles: ["admin"] });
  adminUserId = admin.id;
  adminCookie = admin.cookie;

  const registered = await makeUser({
    label: "registered",
    roles: ["registered"],
  });
  registeredUserId = registered.id;
  registeredCookie = registered.cookie;
});

test.after(async () => {
  if (postId) {
    await db.delete(postsTable).where(eq(postsTable.id, postId));
  }
  for (const userId of [adminUserId, registeredUserId, createdAuthorId]) {
    if (!userId) continue;
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

async function postJson(
  body: unknown,
  cookie?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/og/regenerate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

test("POST /api/og/regenerate without auth returns 401", async () => {
  const { status } = await postJson({
    kind: "insight",
    id: postId,
  });
  assert.equal(status, 401);
});

test("POST /api/og/regenerate with non-admin/editor role returns 403", async () => {
  const { status } = await postJson(
    { kind: "insight", id: postId },
    registeredCookie,
  );
  assert.equal(status, 403);
});

test("POST /api/og/regenerate with malformed body returns 400", async () => {
  const { status, json } = await postJson(
    { kind: "not-a-kind", id: "not-a-uuid" },
    adminCookie,
  );
  assert.equal(status, 400);
  assert.ok(
    json &&
      typeof json === "object" &&
      "error" in (json as Record<string, unknown>),
    "400 should carry an error field",
  );
});

test("POST /api/og/regenerate with unknown UUID returns 404", async () => {
  const fakeUuid = "00000000-0000-4000-8000-000000000000";
  const { status, json } = await postJson(
    { kind: "insight", id: fakeUuid, prerender: true },
    adminCookie,
  );
  assert.equal(status, 404);
  assert.deepEqual(json, { error: "Artifact not found" });
});

test("POST /api/og/regenerate happy path (no prerender) returns 200 with ok=true", async () => {
  const { status, json } = await postJson(
    { kind: "insight", id: postId },
    adminCookie,
  );
  assert.equal(status, 200);
  const body = json as {
    ok?: boolean;
    kind?: string;
    id?: string;
    cleared?: number;
    prerendered?: boolean;
  };
  assert.equal(body.ok, true);
  assert.equal(body.kind, "insight");
  assert.equal(body.id, postId);
  assert.equal(typeof body.cleared, "number");
  assert.equal(body.prerendered, false);
});

test("POST /api/og/regenerate happy path (prerender=true) returns 200 with prerendered=true", async () => {
  const { status, json } = await postJson(
    { kind: "insight", id: postId, prerender: true },
    adminCookie,
  );
  assert.equal(status, 200);
  const body = json as { ok?: boolean; prerendered?: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.prerendered, true);
});
