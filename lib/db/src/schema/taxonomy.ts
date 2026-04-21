import {
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { postsTable } from "./posts";

export const categoriesTable = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("categories_slug_key").on(t.slug)],
);

export const tagsTable = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_slug_key").on(t.slug)],
);

// Enum of every artifact table that can carry taxonomy. When a new
// artifact type is added (e.g. "office"), extend this list — the
// polymorphic join below will accept rows referencing that type.
export const TAXONOMY_ENTITY_TYPES = [
  "post",
  "video",
  "white_paper",
  "workshop",
  "application",
  "case_study",
  "polaris_episode",
  "collateral",
  "service",
  "solution",
] as const;
export type TaxonomyEntityType = (typeof TAXONOMY_ENTITY_TYPES)[number];

export const taxonomyEntityTypeEnum = pgEnum(
  "taxonomy_entity_type",
  TAXONOMY_ENTITY_TYPES,
);

// Polymorphic join from (entity_type, entity_id) -> category/tag. Any
// artifact table that uses uuid primary keys can carry shared taxonomy
// without adding a dedicated join table. (#99)
export const entityCategoriesTable = pgTable(
  "entity_categories",
  {
    entityType: taxonomyEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categoriesTable.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.entityType, t.entityId, t.categoryId] }),
    index("entity_categories_entity_idx").on(t.entityType, t.entityId),
    index("entity_categories_category_idx").on(t.categoryId),
  ],
);

export const entityTagsTable = pgTable(
  "entity_tags",
  {
    entityType: taxonomyEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.entityType, t.entityId, t.tagId] }),
    index("entity_tags_entity_idx").on(t.entityType, t.entityId),
    index("entity_tags_tag_idx").on(t.tagId),
  ],
);

// Post-specific join tables retained as views onto the polymorphic table
// so existing `post_categories` / `post_tags` consumers keep working
// while callers are migrated off. Scheduled for removal once all readers
// use entityCategoriesTable / entityTagsTable directly.
export const postCategories = pgTable(
  "post_categories",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categoriesTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.categoryId] })],
);

export const postTags = pgTable(
  "post_tags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] })],
);

export const categoriesRelations = relations(categoriesTable, ({ many }) => ({
  postCategories: many(postCategories),
  entityCategories: many(entityCategoriesTable),
}));

export const tagsRelations = relations(tagsTable, ({ many }) => ({
  postTags: many(postTags),
  entityTags: many(entityTagsTable),
}));

export const postCategoriesRelations = relations(postCategories, ({ one }) => ({
  post: one(postsTable, { fields: [postCategories.postId], references: [postsTable.id] }),
  category: one(categoriesTable, { fields: [postCategories.categoryId], references: [categoriesTable.id] }),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(postsTable, { fields: [postTags.postId], references: [postsTable.id] }),
  tag: one(tagsTable, { fields: [postTags.tagId], references: [tagsTable.id] }),
}));

export const entityCategoriesRelations = relations(entityCategoriesTable, ({ one }) => ({
  category: one(categoriesTable, {
    fields: [entityCategoriesTable.categoryId],
    references: [categoriesTable.id],
  }),
}));

export const entityTagsRelations = relations(entityTagsTable, ({ one }) => ({
  tag: one(tagsTable, {
    fields: [entityTagsTable.tagId],
    references: [tagsTable.id],
  }),
}));

export type Category = typeof categoriesTable.$inferSelect;
export type Tag = typeof tagsTable.$inferSelect;
export type EntityCategory = typeof entityCategoriesTable.$inferSelect;
export type EntityTag = typeof entityTagsTable.$inferSelect;
