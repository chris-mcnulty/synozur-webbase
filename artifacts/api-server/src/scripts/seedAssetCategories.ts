import { eq, isNull, and, sql } from "drizzle-orm";
import {
  db,
  assetCategoriesTable,
  assetsTable,
  mediaTable,
} from "@workspace/db";

/**
 * Seed the editable asset_categories table from the legacy hardcoded enum
 * values, then backfill existing assets.category_id from assets.category.
 *
 * Idempotent: uses INSERT ... ON CONFLICT (slug) DO NOTHING and only updates
 * category_id where it is currently null.
 */

interface SeedCategory {
  slug: string;
  label: string;
  sortOrder: number;
}

const DEFAULTS: SeedCategory[] = [
  { slug: "people", label: "People", sortOrder: 10 },
  { slug: "north-star", label: "North Star", sortOrder: 20 },
  { slug: "abstract", label: "Abstract", sortOrder: 30 },
  { slug: "event", label: "Event", sortOrder: 40 },
  { slug: "location", label: "Location", sortOrder: 50 },
  { slug: "product-screenshot", label: "Product Screenshot", sortOrder: 60 },
  { slug: "blog-hero", label: "Blog Hero", sortOrder: 70 },
  { slug: "case-study", label: "Case Study", sortOrder: 80 },
  { slug: "workshop", label: "Workshop", sortOrder: 90 },
  { slug: "service-icon", label: "Service Icon", sortOrder: 100 },
  { slug: "client-logo", label: "Client Logo", sortOrder: 110 },
  { slug: "team-headshot", label: "Team Headshot", sortOrder: 120 },
  { slug: "white-paper", label: "White Paper", sortOrder: 130 },
  { slug: "modern-workplace", label: "Modern Workplace", sortOrder: 140 },
  { slug: "night-sky", label: "Night Sky", sortOrder: 150 },
];

export async function seedAssetCategories(): Promise<void> {
  for (const c of DEFAULTS) {
    await db
      .insert(assetCategoriesTable)
      .values(c)
      .onConflictDoNothing({ target: assetCategoriesTable.slug });
  }

  // Backfill assets.category_id from legacy assets.category string.
  const cats = await db.select().from(assetCategoriesTable);
  for (const cat of cats) {
    await db
      .update(assetsTable)
      .set({ categoryId: cat.id })
      .where(
        and(
          eq(assetsTable.category, cat.slug),
          isNull(assetsTable.categoryId),
        ),
      );
  }
}

async function main(): Promise<void> {
  await seedAssetCategories();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetCategoriesTable);
  const [{ tagged }] = await db
    .select({ tagged: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(sql`${assetsTable.categoryId} is not null`);
  const [{ untagged }] = await db
    .select({ untagged: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(sql`${assetsTable.categoryId} is null`);
  const [{ mediaTotal }] = await db
    .select({ mediaTotal: sql<number>`count(*)::int` })
    .from(mediaTable);
  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${count} asset categories. Assets: ${tagged} tagged, ${untagged} untagged. Media rows: ${mediaTotal}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    () => process.exit(0),
    (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    },
  );
}
