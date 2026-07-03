/**
 * Seed `content_parent_pages` rows for all admin-editable pages.
 *
 * Covers two categories:
 *   1. Resource list pages (originally seeded by #97) — one row per
 *      collateral/content list route (insights, case-studies, etc.).
 *   2. Hand-coded static SPA routes (#345, #351) — one row per single-
 *      segment route (/sprint, /about, /events, etc.) so admins can
 *      override the OG share image and SEO copy from the "List page
 *      copy" admin screen without a deploy. Override fields are null
 *      until an editor fills them in; empty fields fall back to the
 *      page's hardcoded STATIC_PAGE_OG defaults in ogResolver.ts.
 *
 * "/" and "/home-b" are intentionally excluded: ogResolver.ts uses the
 * first path segment as the DB lookup key, and "/" has no segment, so a
 * row for it would never be consulted. Use Site Settings' default OG
 * image to control the homepage share card.
 *
 * The admin UI has no create flow, so this script is the sole bootstrap
 * mechanism. It is idempotent — existing rows are left untouched unless
 * --force is passed.
 *
 * Usage:
 *   # idempotent upsert (default):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedContentParentPages.ts
 *
 *   # force-reset one or more existing rows back to seed state
 *   # (override columns -> null, active -> true):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedContentParentPages.ts --force case-studies
 */
import { eq } from "drizzle-orm";
import { db, contentParentPagesTable } from "@workspace/db";

const SLUGS = [
  "videos",
  "white-papers",
  "workshops",
  "applications",
  "models",
  "insights",
  "case-studies",
  "library",
  "items",
  "webinars",
  "start",
  // #345 — Sprint funnel pages. These are hand-coded static routes (not
  // list pages); their rows exist so admins can override the social share
  // image / SEO copy that `ogResolver.ts` serves to crawlers, without a
  // code change. Empty fields fall back to STATIC_PAGE_OG defaults.
  "sprint",
  "proof",
  "fit",
  "book",
  // #351 — Remaining single-segment static routes. Same pattern as the
  // Sprint funnel rows above; gives admins control over share images and
  // SEO copy for every hand-coded page without a deploy.
  "about",
  "clients",
  "partners",
  "contact",
  "team",
  "privacy",
  "terms",
  "trust",
  "join",
  "careers",
  "polaris",
  "events",
];

async function main() {
  const args = process.argv.slice(2);
  const forceIdx = args.indexOf("--force");
  const force = forceIdx !== -1;
  const forceSlugs = force ? args.slice(forceIdx + 1) : [];

  if (force && forceSlugs.length === 0) {
    console.error("--force requires at least one slug, e.g. --force case-studies");
    process.exit(1);
  }
  for (const slug of forceSlugs) {
    if (!SLUGS.includes(slug)) {
      console.error(`Unknown slug: ${slug}. Valid slugs: ${SLUGS.join(", ")}`);
      process.exit(1);
    }
  }

  let created = 0;
  let kept = 0;
  let reset = 0;
  for (const slug of SLUGS) {
    const existing = await db.query.contentParentPagesTable.findFirst({
      where: eq(contentParentPagesTable.slug, slug),
    });
    if (existing) {
      if (forceSlugs.includes(slug)) {
        await db
          .update(contentParentPagesTable)
          .set({
            heroEyebrow: null,
            heroHeadline: null,
            heroSubhead: null,
            introHtml: null,
            seoTitle: null,
            seoDescription: null,
            ogImage: null,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(contentParentPagesTable.slug, slug));
        reset++;
      } else {
        kept++;
      }
      continue;
    }
    await db.insert(contentParentPagesTable).values({ slug, active: true });
    created++;
  }
  console.log(
    `Content parent pages: ${created} created, ${kept} already existed, ${reset} reset.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
