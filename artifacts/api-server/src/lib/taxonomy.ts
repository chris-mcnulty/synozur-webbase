import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  categoriesTable,
  tagsTable,
  entityCategoriesTable,
  entityTagsTable,
  TAXONOMY_ENTITY_TYPES,
  type TaxonomyEntityType,
} from "@workspace/db";

// Polymorphic-taxonomy helpers. Every artifact type (post, video,
// white_paper, workshop, application, case_study, polaris_episode, ...)
// uses these to read/write categories and tags without owning its own
// join table. See #99.

export function assertEntityType(value: string): TaxonomyEntityType {
  if (!(TAXONOMY_ENTITY_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Unknown taxonomy entity type: ${value}`);
  }
  return value as TaxonomyEntityType;
}

export async function getCategoriesFor(
  entityType: TaxonomyEntityType,
  entityId: string,
): Promise<Array<{ id: string; slug: string; name: string }>> {
  const rows = await db
    .select({
      id: categoriesTable.id,
      slug: categoriesTable.slug,
      name: categoriesTable.name,
    })
    .from(entityCategoriesTable)
    .innerJoin(categoriesTable, eq(categoriesTable.id, entityCategoriesTable.categoryId))
    .where(
      and(
        eq(entityCategoriesTable.entityType, entityType),
        eq(entityCategoriesTable.entityId, entityId),
      ),
    )
    .orderBy(categoriesTable.name);
  return rows;
}

export async function getTagsFor(
  entityType: TaxonomyEntityType,
  entityId: string,
): Promise<Array<{ id: string; slug: string; name: string }>> {
  const rows = await db
    .select({
      id: tagsTable.id,
      slug: tagsTable.slug,
      name: tagsTable.name,
    })
    .from(entityTagsTable)
    .innerJoin(tagsTable, eq(tagsTable.id, entityTagsTable.tagId))
    .where(
      and(
        eq(entityTagsTable.entityType, entityType),
        eq(entityTagsTable.entityId, entityId),
      ),
    )
    .orderBy(tagsTable.name);
  return rows;
}

// Replace the set of category ids attached to an entity. Idempotent.
export async function setCategoriesFor(
  entityType: TaxonomyEntityType,
  entityId: string,
  categoryIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(entityCategoriesTable)
      .where(
        and(
          eq(entityCategoriesTable.entityType, entityType),
          eq(entityCategoriesTable.entityId, entityId),
        ),
      );
    if (!categoryIds.length) return;
    const unique = [...new Set(categoryIds)];
    const existing = await tx
      .select({ id: categoriesTable.id })
      .from(categoriesTable)
      .where(inArray(categoriesTable.id, unique));
    const valid = new Set(existing.map((r) => r.id));
    const values = unique
      .filter((id) => valid.has(id))
      .map((categoryId) => ({ entityType, entityId, categoryId }));
    if (values.length) await tx.insert(entityCategoriesTable).values(values);
  });
}

export async function setTagsFor(
  entityType: TaxonomyEntityType,
  entityId: string,
  tagIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(entityTagsTable)
      .where(
        and(
          eq(entityTagsTable.entityType, entityType),
          eq(entityTagsTable.entityId, entityId),
        ),
      );
    if (!tagIds.length) return;
    const unique = [...new Set(tagIds)];
    const existing = await tx
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(inArray(tagsTable.id, unique));
    const valid = new Set(existing.map((r) => r.id));
    const values = unique
      .filter((id) => valid.has(id))
      .map((tagId) => ({ entityType, entityId, tagId }));
    if (values.length) await tx.insert(entityTagsTable).values(values);
  });
}

// Return every (entityType, entityId) pair tagged with the given tag slug,
// grouped by entity type. Used by tag-landing pages.
export async function listEntitiesForTagSlug(
  slug: string,
): Promise<Record<TaxonomyEntityType, string[]>> {
  const tag = await db.query.tagsTable.findFirst({
    where: eq(tagsTable.slug, slug),
  });
  const out = Object.fromEntries(
    TAXONOMY_ENTITY_TYPES.map((t) => [t, [] as string[]]),
  ) as Record<TaxonomyEntityType, string[]>;
  if (!tag) return out;

  // Do not return raw IDs from entity_tags on a public path. The association
  // table alone does not prove the referenced entity is publicly visible
  // (published/active and not soft-deleted). This helper must be updated to
  // join each entityType against its canonical entity table with the same
  // public-visibility predicates used by that type's public list/detail
  // routes before returning results.
  return out;
}
