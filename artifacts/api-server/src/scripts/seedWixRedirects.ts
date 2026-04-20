/**
 * Seed the `wix_redirects` table with the URL patterns inherited from the
 * previous Wix site.  Idempotent: rows are upserted by `sourcePath`, and hit
 * counters are never reset.  Run with:
 *
 *     pnpm dlx tsx artifacts/api-server/src/scripts/seedWixRedirects.ts
 */
import { db, wixRedirectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface SeedRow {
  sourcePath: string;
  targetPath: string;
  notes?: string;
}

// Exact-path mappings known from the Wix information architecture.
// Wildcard / slug-rewrite patterns (`/post/:slug` -> `/insights/:slug`) are
// not expressed here — those are better handled by a pattern middleware if
// needed. For the exact paths below, editors can add more rows via the admin.
const SEEDS: SeedRow[] = [
  { sourcePath: "/post", targetPath: "/insights" },
  { sourcePath: "/blog", targetPath: "/insights" },
  { sourcePath: "/blog-feed", targetPath: "/insights" },
  { sourcePath: "/services-1", targetPath: "/services-overview/default" },
  { sourcePath: "/services-2", targetPath: "/services-overview/default" },
  { sourcePath: "/services-3", targetPath: "/services-overview/default" },
  { sourcePath: "/our-services", targetPath: "/services-overview/default" },
  { sourcePath: "/the-company", targetPath: "/about" },
  { sourcePath: "/about-us", targetPath: "/about" },
  { sourcePath: "/our-clients", targetPath: "/clients" },
  { sourcePath: "/our-team", targetPath: "/team" },
  { sourcePath: "/our-partners", targetPath: "/partners" },
  { sourcePath: "/contact-us", targetPath: "/contact" },
  { sourcePath: "/get-started", targetPath: "/start" },
  { sourcePath: "/events-1", targetPath: "/events" },
  { sourcePath: "/webinar", targetPath: "/webinars" },
  { sourcePath: "/white-papers", targetPath: "/library" },
  { sourcePath: "/resources", targetPath: "/library" },
  { sourcePath: "/case-study", targetPath: "/case-studies" },
  { sourcePath: "/polaris-1", targetPath: "/polaris" },
];

async function main() {
  let upserted = 0;
  let skipped = 0;
  for (const row of SEEDS) {
    const source = row.sourcePath.toLowerCase();
    const existing = await db.query.wixRedirectsTable.findFirst({
      where: eq(wixRedirectsTable.sourcePath, source),
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.insert(wixRedirectsTable).values({
      sourcePath: source,
      targetPath: row.targetPath,
      statusCode: 301,
      active: true,
      notes: row.notes ?? "Seeded from Wix URL map",
    });
    upserted += 1;
  }
  console.log(`wix-redirects seed: inserted ${upserted}, skipped ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
