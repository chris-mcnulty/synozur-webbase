/**
 * Backfill script: copies the legacy `post_categories` / `post_tags` join rows
 * into the new polymorphic `entity_categories` / `entity_tags` tables (#99).
 *
 * Run after `pnpm --filter @workspace/db run push` has applied the polymorphic
 * schema to the target database (#100.5). Idempotent — uses ON CONFLICT DO
 * NOTHING so re-running against a partially-backfilled database is safe.
 *
 * This script does NOT drop the legacy tables. Removal happens in a follow-up
 * once all readers have been switched over to the polymorphic endpoints.
 */
import { sql } from "drizzle-orm";
import {
  db,
  postCategories,
  postTags,
  entityCategoriesTable,
  entityTagsTable,
} from "@workspace/db";

async function main() {
  const cats = await db.select().from(postCategories);
  if (cats.length) {
    await db
      .insert(entityCategoriesTable)
      .values(
        cats.map((row) => ({
          entityType: "post" as const,
          entityId: row.postId,
          categoryId: row.categoryId,
        })),
      )
      .onConflictDoNothing();
  }

  const tags = await db.select().from(postTags);
  if (tags.length) {
    await db
      .insert(entityTagsTable)
      .values(
        tags.map((row) => ({
          entityType: "post" as const,
          entityId: row.postId,
          tagId: row.tagId,
        })),
      )
      .onConflictDoNothing();
  }

  const [catCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(entityCategoriesTable);
  const [tagCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(entityTagsTable);

  console.log(
    `Backfill complete. entity_categories=${catCount?.c ?? 0}, entity_tags=${tagCount?.c ?? 0} ` +
      `(from ${cats.length} post_categories and ${tags.length} post_tags rows).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
