/**
 * Integration test: image data-size / data-align attribute round-trip.
 *
 * Verifies that:
 *   1. body_html stored with <img data-size="..." data-align="..."> is returned
 *      unchanged by the CMS API (server does not strip the custom attributes).
 *   2. Patching body_html to new attribute values persists correctly.
 *   3. Static: CSS rules exist in synozur/src/index.css for data-size and
 *      data-align selectors.
 *   4. Static: the sanitizeHtml allowlist in rich-text.tsx explicitly permits
 *      data-size and data-align on <img> elements.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:image-attrs
 *
 * Uses the configured DATABASE_URL (dev DB). Creates and deletes a throwaway
 * user + post so it is safe to run repeatedly.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, rolesTable, userRoles, postsTable } from "@workspace/db";
import app from "../app";
import type { AddressInfo } from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYNOZUR_SRC = path.resolve(__dirname, "../../../synozur/src");

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
// Helpers
// ---------------------------------------------------------------------------

async function makeAdminUser(): Promise<{ userId: string; email: string; password: string }> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `imgattr-test-${tag}@example.invalid`;
  const password = "TestPass1!";
  const passwordHash = await bcrypt.hash(password, 4);

  const [u] = await db
    .insert(usersTable)
    .values({
      email,
      displayName: "ImgAttr Test",
      authProvider: "local",
      passwordHash,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });

  const adminRole = await db.query.rolesTable.findFirst({
    where: eq(rolesTable.name, "admin"),
  });
  if (!adminRole) throw new Error("admin role not found in roles table");

  await db.insert(userRoles).values({ userId: u.id, roleId: adminRole.id }).onConflictDoNothing();

  return { userId: u.id, email, password };
}

/** Delete all posts authored by userId, then delete the user. */
async function cleanupUser(userId: string): Promise<void> {
  await db.delete(postsTable).where(eq(postsTable.authorId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}

/** Login and return the raw Set-Cookie header value (the session cookie). */
async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  assert.ok(
    res.status === 200 || res.status === 302,
    `Login failed with status ${res.status}`
  );
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, "Expected Set-Cookie header after login");
  return cookie;
}

// ---------------------------------------------------------------------------
// Static assertions (no server needed, but placed here for colocation)
// ---------------------------------------------------------------------------

test("static: CSS rules define data-size and data-align selectors", () => {
  const css = fs.readFileSync(path.join(SYNOZUR_SRC, "index.css"), "utf-8");

  assert.match(css, /img\[data-size="medium"\]/, 'missing img[data-size="medium"] rule');
  assert.match(css, /img\[data-size="small"\]/,  'missing img[data-size="small"] rule');
  assert.match(css, /img\[data-size="full"\]/,   'missing img[data-size="full"] rule');
  assert.match(css, /img\[data-align="left"\]/,  'missing img[data-align="left"] rule');
  assert.match(css, /img\[data-align="right"\]/, 'missing img[data-align="right"] rule');
  assert.match(css, /img\[data-align="center"\]/,'missing img[data-align="center"] rule');
});

test("static: rich-text.tsx sanitizeHtml allowlist permits data-size and data-align on IMG", () => {
  const src = fs.readFileSync(
    path.join(SYNOZUR_SRC, "components", "rich-text.tsx"),
    "utf-8"
  );
  assert.match(
    src,
    /IMG[^}]*"data-size"[^}]*"data-align"/s,
    "sanitizeHtml IMG allowlist must include both data-size and data-align"
  );
});

// ---------------------------------------------------------------------------
// API round-trip tests
// ---------------------------------------------------------------------------

test("round-trip: data-size and data-align are preserved across POST → GET", async () => {
  const { userId, email, password } = await makeAdminUser();

  try {
    const cookie = await login(email, password);

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bodyHtml =
      `<p>intro</p>` +
      `<img src="https://picsum.photos/800/400" alt="test" data-size="full" data-align="center">` +
      `<p>end</p>`;

    const createRes = await fetch(`${baseUrl}/api/cms/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: `ImgAttr test ${tag}`,
        slug: `imgattr-${tag}`,
        bodyHtml,
      }),
    });
    const createBody = await createRes.text();
    assert.ok(createRes.ok, `POST /api/cms/posts failed with status ${createRes.status}: ${createBody}`);
    const created = JSON.parse(createBody) as { id: string };

    const getRes = await fetch(`${baseUrl}/api/cms/posts/${created.id}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200, `GET /api/cms/posts/${created.id} failed`);
    const fetched = (await getRes.json()) as { bodyHtml?: string | null };
    const html = fetched.bodyHtml ?? "";

    assert.match(html, /data-size="full"/, 'data-size="full" not found in fetched bodyHtml');
    assert.match(html, /data-align="center"/, 'data-align="center" not found in fetched bodyHtml');
  } finally {
    await cleanupUser(userId);
  }
});

test("round-trip: PATCH with new data-size and data-align values persists correctly", async () => {
  const { userId, email, password } = await makeAdminUser();

  try {
    const cookie = await login(email, password);

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initialHtml =
      `<p>intro</p>` +
      `<img src="https://picsum.photos/800/400" alt="test" data-size="full" data-align="center">` +
      `<p>end</p>`;

    const createRes = await fetch(`${baseUrl}/api/cms/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: `ImgAttr patch test ${tag}`,
        slug: `imgattr-patch-${tag}`,
        bodyHtml: initialHtml,
      }),
    });
    const createBody = await createRes.text();
    assert.ok(createRes.ok, `POST failed with status ${createRes.status}: ${createBody}`);
    const created = JSON.parse(createBody) as { id: string };

    const updatedHtml =
      `<p>intro</p>` +
      `<img src="https://picsum.photos/800/400" alt="test" data-size="medium" data-align="left">` +
      `<p>end</p>`;

    const patchRes = await fetch(`${baseUrl}/api/cms/posts/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ bodyHtml: updatedHtml }),
    });
    assert.equal(patchRes.status, 200, `PATCH failed: ${await patchRes.text()}`);

    const getRes = await fetch(`${baseUrl}/api/cms/posts/${created.id}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200);
    const fetched = (await getRes.json()) as { bodyHtml?: string | null };
    const html = fetched.bodyHtml ?? "";

    assert.match(html, /data-size="medium"/, 'data-size="medium" missing after PATCH');
    assert.match(html, /data-align="left"/, 'data-align="left" missing after PATCH');
  } finally {
    await cleanupUser(userId);
  }
});

test("round-trip: multiple attributes on the same img tag all survive save/reload", async () => {
  const { userId, email, password } = await makeAdminUser();

  try {
    const cookie = await login(email, password);

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bodyHtml =
      `<p>start</p>` +
      `<img src="https://picsum.photos/600/300" alt="img1" data-size="small" data-align="right">` +
      `<img src="https://picsum.photos/800/400" alt="img2" data-size="medium" data-align="left">` +
      `<p>end</p>`;

    const createRes = await fetch(`${baseUrl}/api/cms/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        title: `ImgAttr multi test ${tag}`,
        slug: `imgattr-multi-${tag}`,
        bodyHtml,
      }),
    });
    assert.ok(createRes.ok, `POST failed with status ${createRes.status}`);
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${baseUrl}/api/cms/posts/${created.id}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200);
    const fetched = (await getRes.json()) as { bodyHtml?: string | null };
    const html = fetched.bodyHtml ?? "";

    assert.match(html, /data-size="small"/,   'data-size="small" lost');
    assert.match(html, /data-align="right"/,  'data-align="right" lost');
    assert.match(html, /data-size="medium"/,  'data-size="medium" lost');
    assert.match(html, /data-align="left"/,   'data-align="left" lost');
  } finally {
    await cleanupUser(userId);
  }
});
