import { pgTable, uuid, text, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
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
}));

export const tagsRelations = relations(tagsTable, ({ many }) => ({
  postTags: many(postTags),
}));

export const postCategoriesRelations = relations(postCategories, ({ one }) => ({
  post: one(postsTable, { fields: [postCategories.postId], references: [postsTable.id] }),
  category: one(categoriesTable, { fields: [postCategories.categoryId], references: [categoriesTable.id] }),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(postsTable, { fields: [postTags.postId], references: [postsTable.id] }),
  tag: one(tagsTable, { fields: [postTags.tagId], references: [tagsTable.id] }),
}));

export type Category = typeof categoriesTable.$inferSelect;
export type Tag = typeof tagsTable.$inferSelect;
