import { isNull, sql } from "drizzle-orm";
import { db, assetCategoriesTable, mediaTable } from "@workspace/db";

/**
 * Backfill media.category_id for all untagged rows.
 *
 * Strategy (applied in order, each step only touches rows that are still
 * uncategorised after the previous step):
 *
 * 1. Ensure every expected category slug exists in asset_categories.
 * 2. Items whose alt_text is NOT a raw Wix URL (i.e. they already have a
 *    human-readable title) are blog hero images → blog-hero.
 * 3. 250×250 PNGs with a Wix URL alt_text are likely icon/logo uploads
 *    → service-icon.
 * 4. 600×350 JPEGs with a Wix URL alt_text are small blog thumbnails
 *    → blog-hero.
 * 5. Remaining Wix-URL items with landscape high-res dimensions are photo
 *    library content → round-robin across people / event / location / abstract.
 * 6. Any remaining untagged PNG (no alt_text) → round-robin across
 *    product-screenshot / service-icon / client-logo / white-paper.
 * 7. Any remaining untagged JPEG (no alt_text) → round-robin across
 *    people / event / location / workshop / team-headshot / case-study.
 * 8. Anything still untagged → abstract (catch-all).
 *
 * Idempotent: only rows where category_id IS NULL are touched.
 */

const EXTRA_CATEGORIES = [
  { slug: "blog-hero", label: "Blog Hero", sortOrder: 70 },
  { slug: "case-study", label: "Case Study", sortOrder: 80 },
  { slug: "workshop", label: "Workshop", sortOrder: 90 },
  { slug: "service-icon", label: "Service Icon", sortOrder: 100 },
  { slug: "client-logo", label: "Client Logo", sortOrder: 110 },
  { slug: "team-headshot", label: "Team Headshot", sortOrder: 120 },
  { slug: "modern-workplace", label: "Modern Workplace", sortOrder: 140 },
];

async function getCategoryId(
  catMap: Map<string, string>,
  slug: string,
): Promise<string> {
  const id = catMap.get(slug);
  if (!id) throw new Error(`Category not found: ${slug}`);
  return id;
}

export async function backfillMediaCategories(): Promise<void> {
  for (const c of EXTRA_CATEGORIES) {
    await db
      .insert(assetCategoriesTable)
      .values(c)
      .onConflictDoNothing({ target: assetCategoriesTable.slug });
  }

  const cats = await db.select().from(assetCategoriesTable);
  const catMap = new Map(cats.map((c) => [c.slug, c.id]));

  const blogHeroId = await getCategoryId(catMap, "blog-hero");
  const serviceIconId = await getCategoryId(catMap, "service-icon");
  const peopleId = await getCategoryId(catMap, "people");
  const eventId = await getCategoryId(catMap, "event");
  const locationId = await getCategoryId(catMap, "location");
  const abstractId = await getCategoryId(catMap, "abstract");
  const productScreenshotId = await getCategoryId(catMap, "product-screenshot");
  const clientLogoId = await getCategoryId(catMap, "client-logo");
  const whitePageId = await getCategoryId(catMap, "white-paper");
  const workshopId = await getCategoryId(catMap, "workshop");
  const teamHeadshotId = await getCategoryId(catMap, "team-headshot");
  const caseStudyId = await getCategoryId(catMap, "case-study");

  // Step 2: Human-readable alt_text (not starting with "wix:") → blog-hero
  await db.execute(sql`
    UPDATE media
    SET category_id = ${blogHeroId}
    WHERE category_id IS NULL
      AND alt_text IS NOT NULL
      AND alt_text NOT LIKE 'wix:%'
  `);

  // Step 3: 250×250 PNG with wix: alt → service-icon
  await db.execute(sql`
    UPDATE media
    SET category_id = ${serviceIconId}
    WHERE category_id IS NULL
      AND alt_text LIKE 'wix:%'
      AND mime = 'image/png'
      AND width = 250
      AND height = 250
  `);

  // Step 4: 600×350 JPEG with wix: alt → blog-hero
  await db.execute(sql`
    UPDATE media
    SET category_id = ${blogHeroId}
    WHERE category_id IS NULL
      AND alt_text LIKE 'wix:%'
      AND mime = 'image/jpeg'
      AND width = 600
      AND height = 350
  `);

  // Step 5: Remaining wix: items (landscape high-res photos) → round-robin
  //   across people / event / location / abstract
  //   Use modulo on row_number() to distribute evenly.
  const photoCategoryIds = [peopleId, eventId, locationId, abstractId];
  await db.execute(sql`
    WITH numbered AS (
      SELECT id,
             (row_number() OVER (ORDER BY created_at) - 1) % ${photoCategoryIds.length} AS bucket
      FROM media
      WHERE category_id IS NULL AND alt_text LIKE 'wix:%'
    )
    UPDATE media m
    SET category_id = CASE numbered.bucket
      WHEN 0 THEN ${photoCategoryIds[0]}::uuid
      WHEN 1 THEN ${photoCategoryIds[1]}::uuid
      WHEN 2 THEN ${photoCategoryIds[2]}::uuid
      WHEN 3 THEN ${photoCategoryIds[3]}::uuid
    END
    FROM numbered
    WHERE m.id = numbered.id
  `);

  // Step 6: Untagged PNGs without alt_text → round-robin across
  //   product-screenshot / service-icon / client-logo / white-paper
  const pngCategoryIds = [
    productScreenshotId,
    serviceIconId,
    clientLogoId,
    whitePageId,
  ];
  await db.execute(sql`
    WITH numbered AS (
      SELECT id,
             (row_number() OVER (ORDER BY created_at) - 1) % ${pngCategoryIds.length} AS bucket
      FROM media
      WHERE category_id IS NULL
        AND alt_text IS NULL
        AND mime = 'image/png'
    )
    UPDATE media m
    SET category_id = CASE numbered.bucket
      WHEN 0 THEN ${pngCategoryIds[0]}::uuid
      WHEN 1 THEN ${pngCategoryIds[1]}::uuid
      WHEN 2 THEN ${pngCategoryIds[2]}::uuid
      WHEN 3 THEN ${pngCategoryIds[3]}::uuid
    END
    FROM numbered
    WHERE m.id = numbered.id
  `);

  // Step 7: Untagged JPEGs (and WebP) without alt_text → round-robin across
  //   people / event / location / workshop / team-headshot / case-study
  const jpegCategoryIds = [
    peopleId,
    eventId,
    locationId,
    workshopId,
    teamHeadshotId,
    caseStudyId,
  ];
  await db.execute(sql`
    WITH numbered AS (
      SELECT id,
             (row_number() OVER (ORDER BY created_at) - 1) % ${jpegCategoryIds.length} AS bucket
      FROM media
      WHERE category_id IS NULL
        AND alt_text IS NULL
        AND mime IN ('image/jpeg', 'image/webp')
    )
    UPDATE media m
    SET category_id = CASE numbered.bucket
      WHEN 0 THEN ${jpegCategoryIds[0]}::uuid
      WHEN 1 THEN ${jpegCategoryIds[1]}::uuid
      WHEN 2 THEN ${jpegCategoryIds[2]}::uuid
      WHEN 3 THEN ${jpegCategoryIds[3]}::uuid
      WHEN 4 THEN ${jpegCategoryIds[4]}::uuid
      WHEN 5 THEN ${jpegCategoryIds[5]}::uuid
    END
    FROM numbered
    WHERE m.id = numbered.id
  `);

  // Step 8: Catch-all — any remaining untagged rows → abstract
  await db.execute(sql`
    UPDATE media
    SET category_id = ${abstractId}
    WHERE category_id IS NULL
  `);
}

async function main(): Promise<void> {
  console.log("Starting media category backfill…");
  await backfillMediaCategories();

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(mediaTable);

  const [{ tagged }] = await db
    .select({ tagged: sql<number>`count(*)::int` })
    .from(mediaTable)
    .where(sql`${mediaTable.categoryId} is not null`);

  const [{ untagged }] = await db
    .select({ untagged: sql<number>`count(*)::int` })
    .from(mediaTable)
    .where(isNull(mediaTable.categoryId));

  const cats = await db.execute<{ slug: string; cnt: number }>(sql`
    SELECT ac.slug, count(m.id)::int AS cnt
    FROM asset_categories ac
    LEFT JOIN media m ON m.category_id = ac.id
    GROUP BY ac.slug, ac.sort_order
    ORDER BY ac.sort_order, ac.slug
  `);

  console.log(`\nMedia: ${tagged}/${total} tagged, ${untagged} untagged`);
  console.log("\nPer-category counts:");
  for (const row of cats.rows) {
    console.log(`  ${row.slug}: ${row.cnt}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
