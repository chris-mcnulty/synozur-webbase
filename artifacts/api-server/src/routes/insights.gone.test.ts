/**
 * #162 / launch-readiness L13 — integration test for HTTP 410 Gone on
 * unpublished public artifact loaders.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:insights-gone
 *
 * The public insight detail loader (`GET /api/insights/:slug`) historically
 * returned 200 with a `noindex` meta when content was archived, which left
 * the URL in Google's index for weeks. The fix routes archived posts (and
 * any artifact whose `unpublished_at` has passed) through HTTP 410 Gone with
 * a friendly JSON body — the explicit signal Google uses to drop the URL
 * promptly.
 *
 * This test covers the happy path:
 *   1. Insert a post in `published` status → confirm the public loader
 *      returns 200.
 *   2. Flip the same row to `archived` → confirm the loader now returns
 *      410 with `{ error: "Gone", code: "gone", message: <non-empty> }`.
 *
 * Side effects (the inserted post and a pinned author user) are cleaned up
 * in `test.after`. Each run picks a unique slug so the test is safe to
 * parallelize against the same dev DB.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, pool, postsTable, usersTable } from "@workspace/db";
import app from "../app";

let server: http.Server;
let baseUrl: string;
const slug = `gone-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let postId: string | null = null;
let createdAuthorId: string | null = null;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Find or create an author. Most dev DBs have users; if not, create one
  // and remember to clean it up.
  const existing = await db.select().from(usersTable).limit(1);
  let authorId: string;
  if (existing.length > 0) {
    authorId = existing[0].id;
  } else {
    const [u] = await db
      .insert(usersTable)
      .values({
        email: `gone-test-${Date.now()}@example.invalid`,
        displayName: "Gone Test Author",
      })
      .returning();
    authorId = u.id;
    createdAuthorId = u.id;
  }

  const [post] = await db
    .insert(postsTable)
    .values({
      slug,
      title: "Gone test post",
      authorId,
      status: "published",
      publishedAt: new Date(Date.now() - 60_000),
    })
    .returning();
  postId = post.id;
});

test.after(async () => {
  if (postId) {
    await db.delete(postsTable).where(eq(postsTable.id, postId));
  }
  if (createdAuthorId) {
    await db.delete(usersTable).where(eq(usersTable.id, createdAuthorId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

test("published post returns 200", async () => {
  const res = await fetch(`${baseUrl}/api/insights/${slug}`);
  assert.equal(res.status, 200, "published post should be reachable");
  const body = (await res.json()) as { slug?: string };
  assert.equal(body.slug, slug);
});

test("archived post returns 410 with a friendly JSON body", async () => {
  await db
    .update(postsTable)
    .set({ status: "archived" })
    .where(eq(postsTable.id, postId!));

  const res = await fetch(`${baseUrl}/api/insights/${slug}`);
  assert.equal(res.status, 410, "archived post should return HTTP 410 Gone");
  const body = (await res.json()) as {
    error?: string;
    code?: string;
    message?: string;
  };
  assert.equal(body.error, "Gone");
  assert.equal(body.code, "gone");
  assert.ok(
    body.message && body.message.length > 0,
    "410 body should carry a non-empty message",
  );
});
