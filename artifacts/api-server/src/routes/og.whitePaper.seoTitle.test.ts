/**
 * Tests: white-paper OG image uses the display title, never seoTitle.
 *
 * Task #464: seoTitle is optimized for search snippets and is often too
 * long for the 1200×630 canvas, truncating mid-sentence. The image render
 * must use the plain display `title`; meta tags still use seoTitle.
 *
 * Two complementary layers of coverage:
 *
 * 1. Unit (resolveArtifact) — directly calls the exported resolver with real
 *    DB rows and asserts that `OgImageInput.title` is the display `title`
 *    even when `seoTitle` is set. This pins the `row.title` expression.
 *
 * 2. Route integration — starts a real Express server, calls
 *    GET /api/og/image?kind=white-paper&id=... and asserts that the route
 *    returns 200 with content-type image/png, proving the full pipeline
 *    (DB lookup → resolveArtifact → renderOgImagePng → HTTP response)
 *    works end-to-end for white papers with and without seoTitle.
 *
 * Together these two layers catch both:
 *   (a) regressions where the resolver picks the wrong field, and
 *   (b) regressions in route wiring or the caching path that would prevent
 *       the renderer from being called at all.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-white-paper-seo-title
 *
 * Hits the real DATABASE_URL. Inserts and fully cleans up two white-paper
 * rows — safe to run alongside any other test suite.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, pool, whitePapersTable } from "@workspace/db";
import { resolveArtifact } from "./og";
import app from "../app";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const slugSeo = `wp-og-seo-${tag}`;
const slugNoSeo = `wp-og-noseo-${tag}`;

let wpWithSeoId: string | null = null;
let wpNoSeoId: string | null = null;
let server: http.Server;
let baseUrl: string;

test.before(async () => {
  // White paper WITH a seoTitle that differs from the plain title.
  const [wpSeo] = await db
    .insert(whitePapersTable)
    .values({
      slug: slugSeo,
      title: "Plain Document Title",
      seoTitle: "SEO-Optimised Title for Social Cards",
      subtitle: "Subtitle text",
      docType: "whitepaper",
      status: "published",
      publishedAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: whitePapersTable.id });
  wpWithSeoId = wpSeo.id;

  // White paper WITHOUT a seoTitle — expects fallback to plain title.
  const [wpNoSeo] = await db
    .insert(whitePapersTable)
    .values({
      slug: slugNoSeo,
      title: "Document Title Without SEO Override",
      docType: "ebook",
      status: "published",
      publishedAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: whitePapersTable.id });
  wpNoSeoId = wpNoSeo.id;

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (wpWithSeoId) {
    await db.delete(whitePapersTable).where(eq(whitePapersTable.id, wpWithSeoId));
  }
  if (wpNoSeoId) {
    await db.delete(whitePapersTable).where(eq(whitePapersTable.id, wpNoSeoId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

// ── Unit: resolveArtifact ─────────────────────────────────────────────────────
// These tests call resolveArtifact directly to pin the exact OgImageInput.title
// value produced for each DB row, independently of the renderer.

test("resolveArtifact white-paper: uses display title even when seoTitle is set", async () => {
  const result = await resolveArtifact("white-paper", wpWithSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(result.input.kind, "white-paper");
  assert.equal(
    result.input.title,
    "Plain Document Title",
    `OgImageInput.title was "${result.input.title}" but expected the display title. ` +
      `The white-paper resolveArtifact branch must use row.title for the image render ` +
      `(seoTitle is meta-tag-only — it is often too long for the 1200×630 canvas).`,
  );
});

test("resolveArtifact white-paper: uses title when seoTitle is absent", async () => {
  const result = await resolveArtifact("white-paper", wpNoSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.title,
    "Document Title Without SEO Override",
    `OgImageInput.title was "${result.input.title}" but expected the plain title when seoTitle is null.`,
  );
});

test("resolveArtifact white-paper: returns null for unknown id", async () => {
  const fakeId = "00000000-0000-4000-8000-000000000000";
  const result = await resolveArtifact("white-paper", fakeId);
  assert.equal(result, null, "Expected null for a non-existent white-paper id");
});

// ── Route integration: GET /api/og/image ─────────────────────────────────────
// These tests exercise the full HTTP pipeline: route handler → resolveArtifact
// → renderOgImagePng → PNG response. They prove the route wiring is intact and
// the renderer is actually invoked for white-paper requests.

test("GET /api/og/image?kind=white-paper returns a PNG for a white paper with seoTitle", async () => {
  const res = await fetch(
    `${baseUrl}/api/og/image?kind=white-paper&id=${encodeURIComponent(wpWithSeoId!)}`,
  );

  assert.equal(
    res.status,
    200,
    `Expected 200 from /api/og/image for white paper with seoTitle, got ${res.status}`,
  );
  const contentType = res.headers.get("content-type") ?? "";
  assert.ok(
    contentType.startsWith("image/png"),
    `Expected content-type image/png, got "${contentType}". ` +
      `The OG image route must return a rendered PNG for white papers with seoTitle.`,
  );
  // Confirm the response body is non-empty so we know rendering was not skipped.
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty — renderOgImagePng may not have been called");
});

test("GET /api/og/image?kind=white-paper returns a PNG for a white paper without seoTitle", async () => {
  const res = await fetch(
    `${baseUrl}/api/og/image?kind=white-paper&id=${encodeURIComponent(wpNoSeoId!)}`,
  );

  assert.equal(
    res.status,
    200,
    `Expected 200 from /api/og/image for white paper without seoTitle, got ${res.status}`,
  );
  const contentType = res.headers.get("content-type") ?? "";
  assert.ok(
    contentType.startsWith("image/png"),
    `Expected content-type image/png, got "${contentType}"`,
  );
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty — renderOgImagePng may not have been called");
});

test("GET /api/og/image?kind=white-paper returns 404 for unknown id", async () => {
  const fakeId = "00000000-0000-4000-8000-000000000000";
  const res = await fetch(`${baseUrl}/api/og/image?kind=white-paper&id=${fakeId}`);
  assert.equal(res.status, 404);
});
