/**
 * Seed the nine `content_parent_pages` rows used by #97.
 *
 * The row set is fixed (one per resource list page) and the admin UI
 * has no create flow, so this script bootstraps the table with
 * `active=true` rows whose override fields are all null. Each list page
 * continues to render its hardcoded defaults until an editor fills in a
 * hero headline or intro.
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
