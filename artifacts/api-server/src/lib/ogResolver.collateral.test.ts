/**
 * Tests: ogResolver library/webinars path resolves the right og:image.
 *
 * The `resolveOgData` function handles two route prefixes that both map to
 * the collateral table:
 *   /library/<slug>   — general resource library items
 *   /webinars/<slug>  — webinar detail pages
 *
 * Both branches use the same logic (lines ~752-780 of ogResolver.ts):
 *   - When heroImage is absent (empty string / null): fall back to the dynamic
 *     OG card URL  → `…/api/og/image?kind=collateral&id=<uuid>&v=…&t=…`
 *   - When heroImage is present (a non-storage external URL): use it as-is
 *     (ogImageVariant passes through URLs it can't resize on its own).
 *
 * A regression in either branch silently reverts to the generic site image —
 * every webinar shared on LinkedIn loses its branded card with no error.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-resolver-collateral
 *
 * Hits the real DATABASE_URL. Inserts seed rows and fully cleans up —
 * safe to run alongside any other suite.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool, collateralTable } from "@workspace/db";
import { resolveOgData, dynamicOgImageUrl } from "./ogResolver";
import { siteOrigin } from "./siteOrigin";

const ORIGIN = siteOrigin();

// ── Fixtures ─────────────────────────────────────────────────────────────────

const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const slugNoHero = `col-resolver-nohero-${tag}`;
const slugWithHero = `col-resolver-hero-${tag}`;

let noHeroId: string | null = null;
let withHeroId: string | null = null;

// An external URL — ogImageVariant passes it through unchanged (no resize).
const EXTERNAL_HERO = "https://example.com/og-test-hero-image.jpg";

test.before(async () => {
  const [noHero] = await db
    .insert(collateralTable)
    .values({
      slug: slugNoHero,
      type: "webinar",
      title: "Webinar Without Hero",
      description: "Test collateral — no heroImage.",
      heroImage: "",
    })
    .returning({ id: collateralTable.id });
  noHeroId = noHero.id;

  const [withHero] = await db
    .insert(collateralTable)
    .values({
      slug: slugWithHero,
      type: "webinar",
      title: "Webinar With Hero",
      description: "Test collateral — heroImage set.",
      heroImage: EXTERNAL_HERO,
    })
    .returning({ id: collateralTable.id });
  withHeroId = withHero.id;
});

test.after(async () => {
  if (noHeroId) {
    await db.delete(collateralTable).where(eq(collateralTable.id, noHeroId));
  }
  if (withHeroId) {
    await db
      .delete(collateralTable)
      .where(eq(collateralTable.id, withHeroId));
  }
  await pool.end();
});

// ── /library/<slug> ───────────────────────────────────────────────────────────

test("resolveOgData /library/<slug>: no heroImage → dynamic OG card URL", async () => {
  const og = await resolveOgData(`/library/${slugNoHero}`);

  assert.ok(
    og.image,
    `og.image is falsy for /library/${slugNoHero}. ` +
      `A missing heroImage must fall back to the dynamic OG card URL, not null.`,
  );
  assert.ok(
    og.image.includes("/api/og/image") && og.image.includes("kind=collateral"),
    `og.image is "${og.image}" but expected a dynamic OG card URL ` +
      `(…/api/og/image?kind=collateral&id=…). ` +
      `When heroImage is absent the resolver must call dynamicOgImageUrl("collateral", …).`,
  );

  // Build the expected URL prefix using the same helper the resolver uses.
  const expected = dynamicOgImageUrl(
    "collateral",
    noHeroId!,
    new Date(),
    ORIGIN,
  );
  // Strip the `&v=…` epoch so we only compare the stable parts.
  const stripV = (u: string) => u.replace(/&v=\d+/, "");
  assert.ok(
    stripV(og.image).startsWith(stripV(expected).split("&v=")[0]),
    `og.image "${og.image}" does not match the expected dynamic URL shape ` +
      `"${expected}" (ignoring &v= timestamp).`,
  );
});

test("resolveOgData /library/<slug>: heroImage set → image URL equals heroImage value", async () => {
  const og = await resolveOgData(`/library/${slugWithHero}`);

  assert.ok(
    og.image,
    `og.image is falsy for /library/${slugWithHero}. ` +
      `A set heroImage must be used as the og:image URL.`,
  );
  assert.ok(
    !og.image.includes("/api/og/image"),
    `og.image "${og.image}" is a dynamic OG card URL but heroImage is set ` +
      `— the resolver must prefer the editor-supplied heroImage.`,
  );
  assert.equal(
    og.image,
    EXTERNAL_HERO,
    `og.image is "${og.image}" but expected "${EXTERNAL_HERO}". ` +
      `When heroImage is set the resolver must use it (via ogImageVariant, ` +
      `which returns external URLs unchanged).`,
  );
});

// ── /webinars/<slug> ──────────────────────────────────────────────────────────

test("resolveOgData /webinars/<slug>: no heroImage → dynamic OG card URL", async () => {
  const og = await resolveOgData(`/webinars/${slugNoHero}`);

  assert.ok(
    og.image,
    `og.image is falsy for /webinars/${slugNoHero}. ` +
      `A missing heroImage must fall back to the dynamic OG card URL, not null.`,
  );
  assert.ok(
    og.image.includes("/api/og/image") && og.image.includes("kind=collateral"),
    `og.image is "${og.image}" but expected a dynamic OG card URL ` +
      `(…/api/og/image?kind=collateral&id=…). ` +
      `When heroImage is absent the resolver must call dynamicOgImageUrl("collateral", …).`,
  );
});

test("resolveOgData /webinars/<slug>: heroImage set → image URL equals heroImage value", async () => {
  const og = await resolveOgData(`/webinars/${slugWithHero}`);

  assert.ok(
    og.image,
    `og.image is falsy for /webinars/${slugWithHero}.`,
  );
  assert.ok(
    !og.image.includes("/api/og/image"),
    `og.image "${og.image}" is a dynamic OG card URL but heroImage is set ` +
      `— the resolver must prefer the editor-supplied heroImage for /webinars/ too.`,
  );
  assert.equal(
    og.image,
    EXTERNAL_HERO,
    `og.image is "${og.image}" but expected "${EXTERNAL_HERO}".`,
  );
});

// ── ogType ────────────────────────────────────────────────────────────────────

test("resolveOgData /library/<slug>: ogType is article", async () => {
  const og = await resolveOgData(`/library/${slugNoHero}`);
  assert.equal(
    og.ogType,
    "article",
    `og.ogType is "${og.ogType}" but library/webinar detail pages should resolve ` +
      `as "article" so LinkedIn shows a link card rather than a website tile.`,
  );
});

test("resolveOgData /webinars/<slug>: ogType is article", async () => {
  const og = await resolveOgData(`/webinars/${slugNoHero}`);
  assert.equal(
    og.ogType,
    "article",
    `og.ogType is "${og.ogType}" but webinar detail pages should resolve ` +
      `as "article".`,
  );
});
