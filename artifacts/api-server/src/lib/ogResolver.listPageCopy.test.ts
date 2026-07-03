/**
 * Tests: ogResolver content_parent_pages (list-page-copy) branch.
 *
 * Single-segment list pages (/case-studies, /applications, /models, etc.)
 * store their seoTitle/seoDescription/ogImage in the `content_parent_pages`
 * table (the "List page copy" admin screen).  `resolveOgData` reads this table
 * in its `!slug` path, after the static-page and landing-pages checks.
 *
 * Scenarios:
 *   1. Active row with full seoTitle + seoDescription + ogImage → resolver
 *      returns the DB-driven copy, not the generic site default.
 *   2. Active row with partial data (seoDescription + ogImage null) → resolver
 *      uses the non-null field and falls back to site defaults for the rest.
 *   3. Active row with no data (all three fields null) → resolver falls through
 *      to site defaults (not the empty string, the real default title/image).
 *   4. Missing row → resolver falls through to site defaults.
 *   5. Inactive row (active=false) → resolver ignores it and returns site defaults.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-resolver-list-page-copy
 *
 * Hits the real DATABASE_URL. Inserts seed rows and fully cleans up —
 * safe to run alongside any other suite.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool, contentParentPagesTable, siteSettingsTable } from "@workspace/db";
import { resolveOgData, SITE_NAME } from "./ogResolver";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Use a random tag so parallel test runs don't collide on slugs.
const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// We use a slug that looks like a real list-page slug but is unique enough that
// it won't match any landing-page or static-page entry.
const slugFull = `lpc-full-${tag}`;
const slugPartial = `lpc-partial-${tag}`;
const slugEmpty = `lpc-empty-${tag}`;
const slugInactive = `lpc-inactive-${tag}`;
// slugMissing intentionally has no DB row.
const slugMissing = `lpc-missing-${tag}`;

// An external absolute ogImage URL — ogImageVariant passes external URLs through.
const OG_IMAGE_URL = "https://example.com/test-og-list-page.jpg";

const insertedIds: string[] = [];

test.before(async () => {
  // Row 1: full seoTitle + seoDescription + ogImage, active.
  const [r1] = await db
    .insert(contentParentPagesTable)
    .values({
      slug: slugFull,
      seoTitle: "Full List Page Title",
      seoDescription: "Full list page description for social crawlers.",
      ogImage: OG_IMAGE_URL,
      active: true,
    })
    .returning({ id: contentParentPagesTable.id });
  insertedIds.push(r1.id);

  // Row 2: only seoTitle, the others null.
  const [r2] = await db
    .insert(contentParentPagesTable)
    .values({
      slug: slugPartial,
      seoTitle: "Partial List Page Title",
      seoDescription: null,
      ogImage: null,
      active: true,
    })
    .returning({ id: contentParentPagesTable.id });
  insertedIds.push(r2.id);

  // Row 3: all three SEO fields null — should still be treated as "no data" and
  // fall back to site defaults even though the row exists and is active.
  const [r3] = await db
    .insert(contentParentPagesTable)
    .values({
      slug: slugEmpty,
      seoTitle: null,
      seoDescription: null,
      ogImage: null,
      active: true,
    })
    .returning({ id: contentParentPagesTable.id });
  insertedIds.push(r3.id);

  // Row 4: inactive — resolver must ignore it.
  const [r4] = await db
    .insert(contentParentPagesTable)
    .values({
      slug: slugInactive,
      seoTitle: "Inactive Row — Should Not Appear",
      seoDescription: "This should never be returned.",
      ogImage: OG_IMAGE_URL,
      active: false,
    })
    .returning({ id: contentParentPagesTable.id });
  insertedIds.push(r4.id);
});

test.after(async () => {
  for (const id of insertedIds) {
    await db
      .delete(contentParentPagesTable)
      .where(eq(contentParentPagesTable.id, id));
  }
  await pool.end();
});

// ── Scenario 1: full row ──────────────────────────────────────────────────────

test("resolveOgData /<slug>: active row with full seoTitle/seoDescription/ogImage → returns DB-driven copy", async () => {
  const og = await resolveOgData(`/${slugFull}`);

  assert.equal(
    og.title,
    "Full List Page Title",
    `og.title is "${og.title}" but expected the seoTitle from content_parent_pages. ` +
      "The resolver must return the DB row's seoTitle for single-segment list pages.",
  );
  assert.equal(
    og.description,
    "Full list page description for social crawlers.",
    `og.description is "${og.description}" but expected the seoDescription from content_parent_pages.`,
  );
  assert.equal(
    og.image,
    OG_IMAGE_URL,
    `og.image is "${og.image}" but expected "${OG_IMAGE_URL}". ` +
      "The resolver must pass through external ogImage URLs unchanged.",
  );
  assert.equal(
    og.ogType,
    "website",
    `og.ogType is "${og.ogType}" but list pages should be "website".`,
  );
});

// ── Scenario 2: partial row (seoTitle only) ───────────────────────────────────

test("resolveOgData /<slug>: active row with only seoTitle → uses seoTitle; description/image fall back to site defaults", async () => {
  const og = await resolveOgData(`/${slugPartial}`);

  assert.equal(
    og.title,
    "Partial List Page Title",
    `og.title is "${og.title}" but expected the seoTitle from the partial content_parent_pages row.`,
  );
  // seoDescription is null → resolver must fall back to the site default, not an empty string.
  assert.ok(
    og.description && og.description.length > 0,
    `og.description is "${og.description}" but a null seoDescription should fall back to a non-empty site default.`,
  );
  assert.notEqual(
    og.description,
    "",
    "og.description must not be an empty string when seoDescription is null.",
  );
  // ogImage is null → resolver must fall back to the site default image, not undefined/null.
  assert.ok(
    og.image && og.image.length > 0,
    `og.image is "${og.image}" but a null ogImage should fall back to the site default image.`,
  );
});

// ── Scenario 3: row exists but all SEO fields are null ────────────────────────

test("resolveOgData /<slug>: active row with all SEO fields null → falls through to site defaults", async () => {
  const og = await resolveOgData(`/${slugEmpty}`);

  // The "if (listRow && (seoTitle || seoDescription || ogImage))" guard means an
  // all-null row is treated as "no data" — the resolver returns site defaults.
  assert.equal(
    og.title,
    SITE_NAME,
    `og.title is "${og.title}" but all-null row should fall back to SITE_NAME "${SITE_NAME}".`,
  );
  assert.ok(
    og.image && og.image.length > 0,
    "og.image must be the site default image when all SEO fields are null.",
  );
});

// ── Scenario 4: missing row ───────────────────────────────────────────────────

test("resolveOgData /<slug>: no content_parent_pages row → falls back to site defaults", async () => {
  const og = await resolveOgData(`/${slugMissing}`);

  assert.equal(
    og.title,
    SITE_NAME,
    `og.title is "${og.title}" but a missing row should fall back to SITE_NAME "${SITE_NAME}".`,
  );
  assert.ok(
    og.image && og.image.length > 0,
    "og.image must be the site default image when no row exists.",
  );
  assert.equal(
    og.ogType,
    "website",
    `og.ogType is "${og.ogType}" but missing-row fallback should be "website".`,
  );
});

// ── Scenario 5: inactive row ──────────────────────────────────────────────────

test("resolveOgData /<slug>: inactive content_parent_pages row → ignored, falls back to site defaults", async () => {
  const og = await resolveOgData(`/${slugInactive}`);

  assert.notEqual(
    og.title,
    "Inactive Row — Should Not Appear",
    `og.title is "${og.title}" but an inactive row must be ignored by the resolver.`,
  );
  assert.equal(
    og.title,
    SITE_NAME,
    `og.title is "${og.title}" but an inactive row should fall back to SITE_NAME "${SITE_NAME}".`,
  );
});

// ── Site defaults are non-trivial ─────────────────────────────────────────────

test("resolveOgData site-default title is the SITE_NAME constant, not empty", async () => {
  // Sanity check: SITE_NAME must not be empty so the assertions above are meaningful.
  assert.ok(
    SITE_NAME && SITE_NAME.trim().length > 0,
    "SITE_NAME must be a non-empty string.",
  );
});
