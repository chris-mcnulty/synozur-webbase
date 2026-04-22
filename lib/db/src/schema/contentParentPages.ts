import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// #97: editable hero + intro copy for resource list pages (/videos,
// /white-papers, /workshops, /applications, /insights, /case-studies,
// /library, /items, /webinars). Each page reads its row at render time
// by `slug` (= first path segment) and falls back to the hardcoded
// defaults in its component when the row is missing or any field is
// null/empty. This lets marketing iterate on parent-page messaging
// without a deploy while keeping the component-level defaults as a
// safety net.

export const contentParentPagesTable = pgTable(
  "content_parent_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // First path segment of the list page, e.g. "videos", "white-papers".
    slug: text("slug").notNull(),
    heroEyebrow: text("hero_eyebrow"),
    heroHeadline: text("hero_headline"),
    heroSubhead: text("hero_subhead"),
    introHtml: text("intro_html"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ogImage: text("og_image"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_parent_pages_slug_key").on(t.slug)],
);

export type ContentParentPage = typeof contentParentPagesTable.$inferSelect;
export type InsertContentParentPage = typeof contentParentPagesTable.$inferInsert;
