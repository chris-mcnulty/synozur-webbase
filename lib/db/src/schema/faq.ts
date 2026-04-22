import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// #107: DB-backed FAQ for /faq. Categories hold display-ordered
// questions; each item renders inside an accordion card with a stable
// anchor (`#<category-slug>/<question-slug>`) so SERP snippets and AI
// citations can deep-link. The page also emits server-friendly
// `application/ld+json` FAQPage structured data from these rows.

export const faqCategoriesTable = pgTable(
  "faq_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    displayOrder: integer("display_order").notNull().default(0),
    // "draft" | "published" — plain text keeps the door open for future
    // states (e.g. "archived") without a schema migration.
    status: text("status").notNull().default("published"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("faq_categories_slug_key").on(t.slug),
    index("faq_categories_display_order_idx").on(t.displayOrder),
  ],
);

export const faqItemsTable = pgTable(
  "faq_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => faqCategoriesTable.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    question: text("question").notNull(),
    answerHtml: text("answer_html").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    status: text("status").notNull().default("published"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Question slugs are only required to be unique within a category,
    // so two categories can each have a "pricing" question anchor.
    uniqueIndex("faq_items_category_slug_key").on(t.categoryId, t.slug),
    index("faq_items_category_idx").on(t.categoryId),
    index("faq_items_display_order_idx").on(t.displayOrder),
  ],
);

export const faqCategoriesRelations = relations(faqCategoriesTable, ({ many }) => ({
  items: many(faqItemsTable),
}));

export const faqItemsRelations = relations(faqItemsTable, ({ one }) => ({
  category: one(faqCategoriesTable, {
    fields: [faqItemsTable.categoryId],
    references: [faqCategoriesTable.id],
  }),
}));

export type FaqCategory = typeof faqCategoriesTable.$inferSelect;
export type InsertFaqCategory = typeof faqCategoriesTable.$inferInsert;
export type FaqItem = typeof faqItemsTable.$inferSelect;
export type InsertFaqItem = typeof faqItemsTable.$inferInsert;
