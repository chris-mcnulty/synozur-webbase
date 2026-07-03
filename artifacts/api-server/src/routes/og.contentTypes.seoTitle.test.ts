/**
 * Tests: case-study, landing-page, service, and solution OG resolvers use
 * their SEO/headline field when set, and fall back to plain title when absent.
 *
 * Mirrors the pattern established in og.whitePaper.seoTitle.test.ts.
 *
 * Two complementary layers per kind:
 *
 * 1. Unit (resolveArtifact) — calls the exported resolver with real DB rows and
 *    asserts that OgImageInput.title uses the preferred field:
 *      - case-study:   `headline || title`
 *      - landing-page: `seoTitle  || title`
 *      - service:      `seoTitle  || title`
 *      - solution:     `seoTitle  || title`
 *
 * 2. Route integration — starts a real Express server, calls
 *    GET /api/og/image?kind=<kind>&id=... and asserts 200 + image/png.
 *
 * Hits the real DATABASE_URL. All rows are inserted in test.before and fully
 * cleaned up in test.after — safe to run alongside any other test suite.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-content-types-seo-title
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
  caseStudiesTable,
  landingPagesTable,
  servicesTable,
  solutionsTable,
} from "@workspace/db";
import { resolveArtifact } from "./og";
import app from "../app";

// ── Shared tag so every slug/title is unique per test run ─────────────────────

const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── Fixture IDs ───────────────────────────────────────────────────────────────

let csWithHeadlineId: string | null = null;
let csNoHeadlineId: string | null = null;

let lpWithSeoId: string | null = null;
let lpNoSeoId: string | null = null;

let svcWithSeoId: string | null = null;
let svcNoSeoId: string | null = null;

let solWithSeoId: string | null = null;
let solNoSeoId: string | null = null;

let server: http.Server;
let baseUrl: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

test.before(async () => {
  // ── Case studies ────────────────────────────────────────────────────────────
  const [csWithHeadline] = await db
    .insert(caseStudiesTable)
    .values({
      slug: `cs-og-headline-${tag}`,
      title: "Case Study Plain Title",
      headline: "Case Study Headline for Social Cards",
    })
    .returning({ id: caseStudiesTable.id });
  csWithHeadlineId = csWithHeadline.id;

  const [csNoHeadline] = await db
    .insert(caseStudiesTable)
    .values({
      slug: `cs-og-noheadline-${tag}`,
      title: "Case Study Without Headline",
      headline: "",
    })
    .returning({ id: caseStudiesTable.id });
  csNoHeadlineId = csNoHeadline.id;

  // ── Landing pages ────────────────────────────────────────────────────────────
  const [lpWithSeo] = await db
    .insert(landingPagesTable)
    .values({
      slug: `lp-og-seo-${tag}`,
      title: "Landing Page Plain Title",
      seoTitle: "Landing Page SEO Title for Social Cards",
      status: "published",
    })
    .returning({ id: landingPagesTable.id });
  lpWithSeoId = lpWithSeo.id;

  const [lpNoSeo] = await db
    .insert(landingPagesTable)
    .values({
      slug: `lp-og-noseo-${tag}`,
      title: "Landing Page Without SEO Title",
      status: "published",
    })
    .returning({ id: landingPagesTable.id });
  lpNoSeoId = lpNoSeo.id;

  // ── Services ─────────────────────────────────────────────────────────────────
  const [svcWithSeo] = await db
    .insert(servicesTable)
    .values({
      slug: `svc-og-seo-${tag}`,
      title: "Service Plain Title",
      seoTitle: "Service SEO Title for Social Cards",
    })
    .returning({ id: servicesTable.id });
  svcWithSeoId = svcWithSeo.id;

  const [svcNoSeo] = await db
    .insert(servicesTable)
    .values({
      slug: `svc-og-noseo-${tag}`,
      title: "Service Without SEO Title",
    })
    .returning({ id: servicesTable.id });
  svcNoSeoId = svcNoSeo.id;

  // ── Solutions ─────────────────────────────────────────────────────────────────
  const [solWithSeo] = await db
    .insert(solutionsTable)
    .values({
      slug: `sol-og-seo-${tag}`,
      title: "Solution Plain Title",
      seoTitle: "Solution SEO Title for Social Cards",
      solutionGroup: "ai_strategy",
    })
    .returning({ id: solutionsTable.id });
  solWithSeoId = solWithSeo.id;

  const [solNoSeo] = await db
    .insert(solutionsTable)
    .values({
      slug: `sol-og-noseo-${tag}`,
      title: "Solution Without SEO Title",
      solutionGroup: "gtm",
    })
    .returning({ id: solutionsTable.id });
  solNoSeoId = solNoSeo.id;

  // ── HTTP server ───────────────────────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (csWithHeadlineId) await db.delete(caseStudiesTable).where(eq(caseStudiesTable.id, csWithHeadlineId));
  if (csNoHeadlineId)   await db.delete(caseStudiesTable).where(eq(caseStudiesTable.id, csNoHeadlineId));

  if (lpWithSeoId) await db.delete(landingPagesTable).where(eq(landingPagesTable.id, lpWithSeoId));
  if (lpNoSeoId)   await db.delete(landingPagesTable).where(eq(landingPagesTable.id, lpNoSeoId));

  if (svcWithSeoId) await db.delete(servicesTable).where(eq(servicesTable.id, svcWithSeoId));
  if (svcNoSeoId)   await db.delete(servicesTable).where(eq(servicesTable.id, svcNoSeoId));

  if (solWithSeoId) await db.delete(solutionsTable).where(eq(solutionsTable.id, solWithSeoId));
  if (solNoSeoId)   await db.delete(solutionsTable).where(eq(solutionsTable.id, solNoSeoId));

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function getOgImage(kind: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/og/image?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// CASE STUDY — uses `headline || title`
// ═════════════════════════════════════════════════════════════════════════════

test("resolveArtifact case-study: uses headline when set", async () => {
  const result = await resolveArtifact("case-study", csWithHeadlineId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(result.input.kind, "case-study");
  assert.equal(
    result.input.title,
    "Case Study Headline for Social Cards",
    `OgImageInput.title was "${result.input.title}" but expected the headline. ` +
      `The case-study resolveArtifact branch must prefer row.headline over row.title.`,
  );
});

test("resolveArtifact case-study: falls back to title when headline is empty", async () => {
  const result = await resolveArtifact("case-study", csNoHeadlineId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.title,
    "Case Study Without Headline",
    `OgImageInput.title was "${result.input.title}" but expected the plain title when headline is empty.`,
  );
});

test("resolveArtifact case-study: returns null for unknown id", async () => {
  const result = await resolveArtifact("case-study", "00000000-0000-4000-8000-000000000001");
  assert.equal(result, null, "Expected null for a non-existent case-study id");
});

test("GET /api/og/image?kind=case-study returns PNG for row with headline", async () => {
  const res = await getOgImage("case-study", csWithHeadlineId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=case-study returns PNG for row without headline", async () => {
  const res = await getOgImage("case-study", csNoHeadlineId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=case-study returns 404 for unknown id", async () => {
  const res = await getOgImage("case-study", "00000000-0000-4000-8000-000000000001");
  assert.equal(res.status, 404);
});

// ═════════════════════════════════════════════════════════════════════════════
// LANDING PAGE — uses `seoTitle || title`
// ═════════════════════════════════════════════════════════════════════════════

test("resolveArtifact landing-page: uses seoTitle when set", async () => {
  const result = await resolveArtifact("landing-page", lpWithSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(result.input.kind, "landing-page");
  assert.equal(
    result.input.title,
    "Landing Page SEO Title for Social Cards",
    `OgImageInput.title was "${result.input.title}" but expected the seoTitle. ` +
      `The landing-page resolveArtifact branch must prefer row.seoTitle over row.title.`,
  );
});

test("resolveArtifact landing-page: falls back to title when seoTitle is absent", async () => {
  const result = await resolveArtifact("landing-page", lpNoSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.title,
    "Landing Page Without SEO Title",
    `OgImageInput.title was "${result.input.title}" but expected the plain title when seoTitle is null.`,
  );
});

test("resolveArtifact landing-page: returns null for unknown id", async () => {
  const result = await resolveArtifact("landing-page", "00000000-0000-4000-8000-000000000002");
  assert.equal(result, null, "Expected null for a non-existent landing-page id");
});

test("GET /api/og/image?kind=landing-page returns PNG for row with seoTitle", async () => {
  const res = await getOgImage("landing-page", lpWithSeoId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=landing-page returns PNG for row without seoTitle", async () => {
  const res = await getOgImage("landing-page", lpNoSeoId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=landing-page returns 404 for unknown id", async () => {
  const res = await getOgImage("landing-page", "00000000-0000-4000-8000-000000000002");
  assert.equal(res.status, 404);
});

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE — uses `seoTitle || title`
// ═════════════════════════════════════════════════════════════════════════════

test("resolveArtifact service: uses seoTitle when set", async () => {
  const result = await resolveArtifact("service", svcWithSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(result.input.kind, "service");
  assert.equal(
    result.input.title,
    "Service SEO Title for Social Cards",
    `OgImageInput.title was "${result.input.title}" but expected the seoTitle. ` +
      `The service resolveArtifact branch must prefer row.seoTitle over row.title.`,
  );
});

test("resolveArtifact service: falls back to title when seoTitle is absent", async () => {
  const result = await resolveArtifact("service", svcNoSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.title,
    "Service Without SEO Title",
    `OgImageInput.title was "${result.input.title}" but expected the plain title when seoTitle is null.`,
  );
});

test("resolveArtifact service: returns null for unknown id", async () => {
  const result = await resolveArtifact("service", "00000000-0000-4000-8000-000000000003");
  assert.equal(result, null, "Expected null for a non-existent service id");
});

test("GET /api/og/image?kind=service returns PNG for row with seoTitle", async () => {
  const res = await getOgImage("service", svcWithSeoId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=service returns PNG for row without seoTitle", async () => {
  const res = await getOgImage("service", svcNoSeoId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=service returns 404 for unknown id", async () => {
  const res = await getOgImage("service", "00000000-0000-4000-8000-000000000003");
  assert.equal(res.status, 404);
});

// ═════════════════════════════════════════════════════════════════════════════
// SOLUTION — uses `seoTitle || title`
// ═════════════════════════════════════════════════════════════════════════════

test("resolveArtifact solution: uses seoTitle when set", async () => {
  const result = await resolveArtifact("solution", solWithSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(result.input.kind, "solution");
  assert.equal(
    result.input.title,
    "Solution SEO Title for Social Cards",
    `OgImageInput.title was "${result.input.title}" but expected the seoTitle. ` +
      `The solution resolveArtifact branch must prefer row.seoTitle over row.title.`,
  );
});

test("resolveArtifact solution: falls back to title when seoTitle is absent", async () => {
  const result = await resolveArtifact("solution", solNoSeoId!);

  assert.ok(result !== null, "Expected a resolved artifact, got null");
  assert.equal(
    result.input.title,
    "Solution Without SEO Title",
    `OgImageInput.title was "${result.input.title}" but expected the plain title when seoTitle is null.`,
  );
});

test("resolveArtifact solution: returns null for unknown id", async () => {
  const result = await resolveArtifact("solution", "00000000-0000-4000-8000-000000000004");
  assert.equal(result, null, "Expected null for a non-existent solution id");
});

test("GET /api/og/image?kind=solution returns PNG for row with seoTitle", async () => {
  const res = await getOgImage("solution", solWithSeoId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=solution returns PNG for row without seoTitle", async () => {
  const res = await getOgImage("solution", solNoSeoId!);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(ct.startsWith("image/png"), `Expected image/png, got "${ct}"`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0, "Response body is empty");
});

test("GET /api/og/image?kind=solution returns 404 for unknown id", async () => {
  const res = await getOgImage("solution", "00000000-0000-4000-8000-000000000004");
  assert.equal(res.status, 404);
});
