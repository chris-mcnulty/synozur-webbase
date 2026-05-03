import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import {
  artifactIdentity,
  artifactLifecycle,
  artifactTimestamps,
} from "./_artifactBase";
import { tsvector } from "./_searchTsv";

// #107 / #108: DB-backed FAQ for /faq.
//
// #108 brought these tables onto the shared #98 artifact-type pattern so the
// visibility filter (`active`, `deletedAt`, `publishedAt`/`unpublishedAt`)
// matches every other artifact type. `name` (categories) and `question`
// (items) remain the domain-facing display fields; `title` from the shared
// identity mirrors them and is what generic artifact tooling reads.
//
// Categories hold display-ordered questions; each item renders inside an
// accordion card with a stable anchor (`#<category-slug>/<question-slug>`)
// so SERP snippets and AI citations can deep-link. The page also emits
// `application/ld+json` FAQPage structured data from these rows.

export const faqCategoriesTable = pgTable(
  "faq_categories",
  {
    ...artifactIdentity,
    name: text("name").notNull(),
    description: text("description"),
    displayOrder: integer("display_order").notNull().default(0),
    ...artifactLifecycle,
    ...artifactTimestamps,
  },
  (t) => [
    uniqueIndex("faq_categories_slug_key").on(t.slug),
    index("faq_categories_display_order_idx").on(t.displayOrder),
    index("faq_categories_published_at_idx").on(t.publishedAt),
  ],
);

export const faqItemsTable = pgTable(
  "faq_items",
  {
    ...artifactIdentity,
    categoryId: uuid("category_id")
      .notNull()
      .references(() => faqCategoriesTable.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answerHtml: text("answer_html").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ...artifactLifecycle,
    ...artifactTimestamps,
    // #170: full-text search vector — see posts.ts comment.
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(question, '')), 'A') || setweight(to_tsvector('english', coalesce(seo_description, '')), 'B') || setweight(to_tsvector('english', regexp_replace(coalesce(answer_html, ''), '<[^>]+>', ' ', 'g')), 'C')`,
    ),
  },
  (t) => [
    // Question slugs are only required to be unique within a category,
    // so two categories can each have a "pricing" question anchor.
    uniqueIndex("faq_items_category_slug_key").on(t.categoryId, t.slug),
    index("faq_items_category_idx").on(t.categoryId),
    index("faq_items_display_order_idx").on(t.displayOrder),
    index("faq_items_published_at_idx").on(t.publishedAt),
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
