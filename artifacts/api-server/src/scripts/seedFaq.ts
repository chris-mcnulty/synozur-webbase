/**
 * Seed the #107 FAQ tables from `tools/insights-crawler/output/faq.json`.
 *
 * Usage:
 *   pnpm --filter @workspace/insights-crawler exec tsx src/faq.ts
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedFaq.ts
 *
 * Idempotent: categories dedup by slug, items dedup by (categoryId, slug).
 * Re-running updates existing rows in place.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import slugify from "slugify";
import { db, faqCategoriesTable, faqItemsTable } from "@workspace/db";

interface ScrapedItem {
  question: string;
  answerHtml: string;
}
interface ScrapedCategory {
  slug: string;
  name: string;
  description: string | null;
  items: ScrapedItem[];
}
interface ScrapedPayload {
  source: string;
  categories: ScrapedCategory[];
}

const INPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../tools/insights-crawler/output/faq.json",
);

function toSlug(input: string): string {
  return (
    slugify(input, { lower: true, strict: true, trim: true }).slice(0, 80) || "faq"
  );
}

async function readPayload(): Promise<ScrapedPayload> {
  const raw = await readFile(INPUT_PATH, "utf8");
  return JSON.parse(raw) as ScrapedPayload;
}

async function upsertCategory(
  scraped: ScrapedCategory,
  displayOrder: number,
): Promise<string> {
  const slug = scraped.slug || toSlug(scraped.name);
  const existing = await db.query.faqCategoriesTable.findFirst({
    where: eq(faqCategoriesTable.slug, slug),
  });
  if (existing) {
    await db
      .update(faqCategoriesTable)
      .set({
        name: scraped.name,
        description: scraped.description,
        displayOrder,
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(faqCategoriesTable.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(faqCategoriesTable)
    .values({
      slug,
      name: scraped.name,
      description: scraped.description,
      displayOrder,
      status: "published",
    })
    .returning();
  return row!.id;
}

async function upsertItem(
  categoryId: string,
  scraped: ScrapedItem,
  displayOrder: number,
): Promise<void> {
  const slug = toSlug(scraped.question);
  const existing = await db.query.faqItemsTable.findFirst({
    where: and(
      eq(faqItemsTable.categoryId, categoryId),
      eq(faqItemsTable.slug, slug),
    ),
  });
  if (existing) {
    await db
      .update(faqItemsTable)
      .set({
        question: scraped.question,
        answerHtml: scraped.answerHtml,
        displayOrder,
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(faqItemsTable.id, existing.id));
    return;
  }
  await db.insert(faqItemsTable).values({
    categoryId,
    slug,
    question: scraped.question,
    answerHtml: scraped.answerHtml,
    displayOrder,
    status: "published",
    publishedAt: new Date(),
  });
}

async function main() {
  const payload = await readPayload();
  let createdCategories = 0;
  let updatedCategories = 0;
  let upsertedItems = 0;

  for (let ci = 0; ci < payload.categories.length; ci++) {
    const c = payload.categories[ci]!;
    const beforeId = await db.query.faqCategoriesTable.findFirst({
      where: eq(faqCategoriesTable.slug, c.slug || toSlug(c.name)),
    });
    const categoryId = await upsertCategory(c, (ci + 1) * 10);
    if (beforeId) updatedCategories++;
    else createdCategories++;
    for (let ii = 0; ii < c.items.length; ii++) {
      await upsertItem(categoryId, c.items[ii]!, (ii + 1) * 10);
      upsertedItems++;
    }
  }

  console.log(
    `FAQ seed: ${createdCategories} categories created, ${updatedCategories} updated, ${upsertedItems} items upserted.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
