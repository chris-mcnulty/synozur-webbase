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
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedContentParentPages.ts
 *
 * Idempotent: upserts by slug.
 */
import { eq } from "drizzle-orm";
import { db, contentParentPagesTable } from "@workspace/db";

const SLUGS = [
  "videos",
  "white-papers",
  "workshops",
  "applications",
  "insights",
  "case-studies",
  "library",
  "items",
  "webinars",
];

async function main() {
  let created = 0;
  let kept = 0;
  for (const slug of SLUGS) {
    const existing = await db.query.contentParentPagesTable.findFirst({
      where: eq(contentParentPagesTable.slug, slug),
    });
    if (existing) {
      kept++;
      continue;
    }
    await db.insert(contentParentPagesTable).values({ slug, active: true });
    created++;
  }
  console.log(
    `Content parent pages: ${created} created, ${kept} already existed.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
