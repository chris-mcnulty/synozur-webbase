/**
 * Sitemap FAQ guard — task #526.
 *
 * Asserts that `collectEntries()` never emits three-segment FAQ item URLs
 * (/faq/:category/:item). These pages set rel=canonical to the parent
 * category page; including them in the sitemap would spread crawl budget
 * and indexing signals across 51+ thin single-question pages.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:sitemap-faq
 *
 * Two-segment category pages (/faq/:category) must still appear — the test
 * seeds a real category row so that invariant is verified against a live
 * DB response, not just an empty result.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, pool, faqCategoriesTable, landingPagesTable, bookingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { collectEntries } from "./seo.js";
import { siteOrigin } from "../lib/siteOrigin.js";

after(async () => { await pool.end(); });

// Three-segment FAQ path: /faq/<category>/<item>
const FAQ_ITEM_RE = /\/faq\/[^/]+\/[^/]+/;

// Two-segment FAQ path: /faq/<category>  (no trailing segment)
const FAQ_CATEGORY_RE = /\/faq\/[^/]+$/;

/**
 * Generate a slug that is unique per test run so concurrent or repeated runs
 * never collide with each other or with real production data.
 */
function uniqueSlug(): string {
  return `test-faq-guard-${crypto.randomBytes(4).toString("hex")}`;
}

test("collectEntries: no three-segment FAQ item URLs appear in the sitemap", async () => {
  const slug = uniqueSlug();

  // Seed one published category so the assertion below is checking a
  // non-empty FAQ section — an empty DB could pass vacuously.
  await db.insert(faqCategoriesTable).values({
    slug,
    title: "Test FAQ Category (sitemap guard)",
    name: "Test FAQ Category (sitemap guard)",
    status: "published",
    active: true,
    publishedAt: new Date("2020-01-01"),
  });

  try {
    const entries = await collectEntries();

    // Every returned entry is an absolute URL; extract the path by stripping
    // the origin prefix up to the first path slash.
    const paths = entries.map((e) => {
      try {
        return new URL(e.loc).pathname;
      } catch {
        // Fall back for relative locs (shouldn't happen but be safe).
        return e.loc;
      }
    });

    // Primary invariant: no three-segment FAQ paths.
    const itemPaths = paths.filter((p) => FAQ_ITEM_RE.test(p));
    assert.deepEqual(
      itemPaths,
      [],
      `collectEntries() must never emit /faq/:category/:item URLs ` +
        `(found: ${JSON.stringify(itemPaths)}). ` +
        `These pages use rel=canonical to the category page; ` +
        `re-adding them to the sitemap would harm crawl quality.`,
    );

    // Secondary invariant: the seeded category page appears as /faq/<slug>.
    const categoryPaths = paths.filter((p) => FAQ_CATEGORY_RE.test(p));
    const seededPath = `/faq/${slug}`;
    assert.ok(
      categoryPaths.includes(seededPath),
      `collectEntries() must include the two-segment category URL ` +
        `"${seededPath}" (found FAQ paths: ${JSON.stringify(categoryPaths)}).`,
    );
  } finally {
    await db.delete(faqCategoriesTable).where(eq(faqCategoriesTable.slug, slug));
  }
});

test("collectEntries: landing and booking pages use stored slugs, visibility windows and canonicals", async () => {
  const prefix = `test-sitemap-${crypto.randomBytes(6).toString("hex")}`;
  const past = new Date(Date.now() - 60_000);
  // A near-future instant also guards against accidentally using date-only
  // publication rules instead of the public landing API's instant check.
  const future = new Date(Date.now() + 60 * 60_000);
  const updatedAt = new Date("2024-03-04T05:06:07.000Z");
  const landingCases = [
    { key: "published", include: true },
    { key: "window", include: true, publishedAt: past, unpublishedAt: future },
    { key: "inactive", include: false, active: false },
    { key: "draft", include: false, status: "draft" as const },
    { key: "scheduled", include: false, publishedAt: future },
    { key: "expired", include: false, unpublishedAt: past },
    { key: "deleted", include: false, deletedAt: past },
    { key: "self-relative", include: true, seoCanonicalUrl: `/${prefix}-self-relative` },
    { key: "self-absolute", include: true, seoCanonicalUrl: `${siteOrigin()}/${prefix}-self-absolute` },
    { key: "alias-relative", include: false, seoCanonicalUrl: `/${prefix}-published` },
    { key: "alias-absolute", include: false, seoCanonicalUrl: `${siteOrigin()}/${prefix}-published` },
    { key: "alias-hidden", include: false, seoCanonicalUrl: `/${prefix}-draft` },
    { key: "external", include: true, seoCanonicalUrl: "https://example.org/elsewhere" },
  ];
  const bookingCases = [
    { key: "always", include: true },
    { key: "window", include: true, startsAt: past, endsAt: future },
    { key: "inactive", include: false, active: false },
    { key: "scheduled", include: false, startsAt: future },
    { key: "expired", include: false, endsAt: past },
  ];
  const landingSlugs = landingCases.map(c => `${prefix}-${c.key}`);
  const bookingSlugs = bookingCases.map(c => `${prefix}-${c.key}`);
  try {
    await db.insert(landingPagesTable).values(landingCases.map(({ key, include, ...fields }) => ({
      slug: `${prefix}-${key}`, title: "Sitemap test", status: "published" as const,
      active: true, updatedAt, ...fields,
    })));
    await db.insert(bookingsTable).values(bookingCases.map(({ key, include, ...fields }) => ({
      slug: `${prefix}-${key}`, title: "Sitemap test", embedUrl: "https://example.org/booking",
      active: true, updatedAt, ...fields,
    })));
    const entries = await collectEntries();
    for (const [base, cases] of [["", landingCases], ["/start", bookingCases]] as const) {
      for (const c of cases) {
        const loc = `${siteOrigin()}${base}/${prefix}-${c.key}`;
        const matches = entries.filter(e => e.loc === loc);
        assert.equal(matches.length, c.include ? 1 : 0, loc);
        if (c.include) assert.equal(matches[0].lastmod, updatedAt.toISOString());
      }
    }
    assert.equal(new Set(entries.map(e => e.loc)).size, entries.length, "No duplicate URLs");
    assert.equal(entries.filter(e => e.loc === `${siteOrigin()}/start`).length, 1, "Keep the booking hub");
    assert.ok(!entries.some(e => e.loc === "https://example.org/elsewhere"), "No external targets");
  } finally {
    await db.delete(landingPagesTable).where(inArray(landingPagesTable.slug, landingSlugs));
    await db.delete(bookingsTable).where(inArray(bookingsTable.slug, bookingSlugs));
  }
});
