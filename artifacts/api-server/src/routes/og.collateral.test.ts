/**
 * Tests: collateral OG image endpoint covers webinar / library cards.
 *
 * Two complementary layers of coverage:
 *
 * 1. Unit (resolveArtifact) — directly calls the exported resolver with a
 *    real DB row and asserts that OgImageInput fields are mapped correctly:
 *    seoTitle is preferred over title; subtitle drives the context label; the
 *    type enum falls back to the human-readable typeLabel map.  Also verifies
 *    that resolveArtifact returns null for a non-existent id.
 *
 * 2. Route integration — starts a real Express server, calls
 *    GET /api/og/image?kind=collateral&id=... and asserts the route returns
 *    HTTP 200, content-type image/png, and a non-empty body at exactly
 *    1200×630 px — the canonical OG share-card dimensions.  This proves the
 *    full pipeline (DB lookup → resolveArtifact → renderOgImagePng → PNG
 *    response) works end-to-end for collateral rows.
 *
 * Together these two layers catch:
 *   (a) regressions in field mapping inside resolveArtifact's collateral branch
 *   (b) route-wiring or render failures that would silently fall back to the
 *       generic site image on LinkedIn / Slack / Teams
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-collateral
 *
 * Hits the real DATABASE_URL. Inserts a seed collateral row and fully cleans
 * up after itself — safe to run alongside any other suite.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, pool, collateralTable } from "@workspace/db";
import { resolveArtifact } from "./og";
import app from "../app";

// Canonical OG card dimensions.  The ogImageRenderer builds an SVG at
// 1200×630 CSS pixels and rasterises with sharp({ density: 72 }) so that
// one SVG CSS pixel maps exactly to one raster pixel.  These are the
// dimensions LinkedIn / Slack / Teams require for a correctly formatted card.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const slugWebinar = `col-og-webinar-${tag}`;
const slugEbook = `col-og-ebook-${tag}`;

let webinarId: string | null = null;
let ebookId: string | null = null;
let server: http.Server;
let baseUrl: string;

test.before(async () => {
  // Webinar with seoTitle and subtitle.
  const [webinar] = await db
    .insert(collateralTable)
    .values({
      slug: slugWebinar,
      type: "webinar",
      title: "Plain Webinar Title",
      seoTitle: "SEO-Optimised Webinar Title for Social Cards",
      subtitle: "Live session",
      description: "A test webinar.",
      heroImage: "",
    })
    .returning({ id: collateralTable.id });
  webinarId = webinar.id;

  // eBook without seoTitle or subtitle — falls back to title + type label.
  const [ebook] = await db
    .insert(collateralTable)
    .values({
      slug: slugEbook,
      type: "ebook",
      title: "Collateral Without SEO Title",
      description: "A test ebook.",
      heroImage: "",
    })
    .returning({ id: collateralTable.id });
  ebookId = ebook.id;

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (webinarId) {
    await db.delete(collateralTable).where(eq(collateralTable.id, webinarId));
  }
  if (ebookId) {
    await db.delete(collateralTable).where(eq(collateralTable.id, ebookId));
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

// ── Unit: resolveArtifact ─────────────────────────────────────────────────────

test("resolveArtifact collateral: uses seoTitle when set", async () => {
  const result = await resolveArtifact("collateral", webinarId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(result.input.kind, "collateral");
  assert.equal(
    result.input.title,
    "SEO-Optimised Webinar Title for Social Cards",
    `OgImageInput.title was "${result.input.title}" but expected the seoTitle. ` +
      `The collateral resolveArtifact branch must prefer row.seoTitle over row.title.`,
  );
});

test("resolveArtifact collateral: uses subtitle as context when set", async () => {
  const result = await resolveArtifact("collateral", webinarId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.context,
    "Live session",
    `OgImageInput.context was "${result.input.context}" but expected the subtitle value.`,
  );
});

test("resolveArtifact collateral: falls back to plain title when seoTitle is absent", async () => {
  const result = await resolveArtifact("collateral", ebookId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.title,
    "Collateral Without SEO Title",
    `OgImageInput.title was "${result.input.title}" but expected the plain title when seoTitle is null.`,
  );
});

test("resolveArtifact collateral: uses type label as context when subtitle is absent", async () => {
  const result = await resolveArtifact("collateral", ebookId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.context,
    "eBook",
    `OgImageInput.context was "${result.input.context}" but expected the type label "eBook" ` +
      `when subtitle is null and the type is "ebook". ` +
      `Verify the typeLabels map in resolveArtifact's collateral branch.`,
  );
});

test("resolveArtifact collateral: returns null for unknown id", async () => {
  const fakeId = "00000000-0000-4000-8000-000000000000";
  const result = await resolveArtifact("collateral", fakeId);
  assert.equal(result, null, "Expected null for a non-existent collateral id");
});

// ── Route integration: GET /api/og/image ──────────────────────────────────────
// These tests exercise the full HTTP pipeline: route handler → resolveArtifact
// → renderOgImagePng → PNG response.  They prove the route wiring is intact,
// the renderer is actually invoked for collateral requests, and the output PNG
// is exactly 1200×630 so LinkedIn / Slack / Teams render it correctly.

test("GET /api/og/image?kind=collateral returns a 1200×630 PNG for a webinar row", async () => {
  const res = await fetch(
    `${baseUrl}/api/og/image?kind=collateral&id=${encodeURIComponent(webinarId!)}`,
  );

  assert.equal(
    res.status,
    200,
    `Expected 200 from /api/og/image for collateral webinar, got ${res.status}`,
  );
  const contentType = res.headers.get("content-type") ?? "";
  assert.ok(
    contentType.startsWith("image/png"),
    `Expected content-type image/png, got "${contentType}". ` +
      `The OG image route must return a rendered PNG for collateral rows.`,
  );

  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(
    buf.length > 0,
    "Response body is empty — renderOgImagePng may not have been called",
  );

  const meta = await sharp(buf).metadata();
  assert.equal(
    meta.width,
    OG_WIDTH,
    `PNG width is ${meta.width}px, expected ${OG_WIDTH}px. ` +
      `The generated OG card must be exactly 1200px wide for LinkedIn / Slack.`,
  );
  assert.equal(
    meta.height,
    OG_HEIGHT,
    `PNG height is ${meta.height}px, expected ${OG_HEIGHT}px. ` +
      `The generated OG card must be exactly 630px tall.`,
  );
});

test("GET /api/og/image?kind=collateral returns a 1200×630 PNG for an ebook row", async () => {
  const res = await fetch(
    `${baseUrl}/api/og/image?kind=collateral&id=${encodeURIComponent(ebookId!)}`,
  );

  assert.equal(
    res.status,
    200,
    `Expected 200 from /api/og/image for collateral ebook, got ${res.status}`,
  );
  const contentType = res.headers.get("content-type") ?? "";
  assert.ok(
    contentType.startsWith("image/png"),
    `Expected content-type image/png, got "${contentType}"`,
  );

  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");

  const meta = await sharp(buf).metadata();
  assert.equal(
    meta.width,
    OG_WIDTH,
    `PNG width is ${meta.width}px, expected ${OG_WIDTH}px`,
  );
  assert.equal(
    meta.height,
    OG_HEIGHT,
    `PNG height is ${meta.height}px, expected ${OG_HEIGHT}px`,
  );
});

test("GET /api/og/image?kind=collateral returns 404 for unknown id", async () => {
  const fakeId = "00000000-0000-4000-8000-000000000000";
  const res = await fetch(
    `${baseUrl}/api/og/image?kind=collateral&id=${fakeId}`,
  );
  assert.equal(
    res.status,
    404,
    `Expected 404 for non-existent collateral id, got ${res.status}`,
  );
});
