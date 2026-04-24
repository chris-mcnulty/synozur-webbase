import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const WHITE_PAPER_DOC_TYPES = ["whitepaper", "ebook", "report", "guide"] as const;
export type WhitePaperDocType = (typeof WHITE_PAPER_DOC_TYPES)[number];

export const whitePaperDocTypeEnum = pgEnum(
  "white_paper_doc_type",
  WHITE_PAPER_DOC_TYPES,
);

export const WHITE_PAPER_STATUSES = ["draft", "published", "archived"] as const;
export type WhitePaperStatus = (typeof WHITE_PAPER_STATUSES)[number];

export const whitePaperStatusEnum = pgEnum(
  "white_paper_status",
  WHITE_PAPER_STATUSES,
);

export const whitePapersTable = pgTable(
  "white_papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    docType: whitePaperDocTypeEnum("doc_type").notNull().default("whitepaper"),
    heroImage: text("hero_image").notNull().default(""),
    heroImageAlt: text("hero_image_alt"),
    shortDescription: text("short_description").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    pillar: text("pillar"),
    documentUrl: text("document_url"),
    documentAssetId: integer("document_asset_id"),
    externalUrl: text("external_url"),
    pageCount: integer("page_count"),
    status: whitePaperStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
    featured: boolean("featured").notNull().default(false),
    featuredRank: integer("featured_rank"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ogImage: text("og_image"),
    active: boolean("active").notNull().default(true),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("white_papers_slug_key").on(t.slug),
    uniqueIndex("white_papers_source_id_key").on(t.sourceId),
    index("white_papers_doc_type_idx").on(t.docType),
    index("white_papers_status_idx").on(t.status),
    index("white_papers_published_at_idx").on(t.publishedAt),
    index("white_papers_featured_rank_idx").on(t.featured, t.featuredRank),
  ],
);

export type WhitePaper = typeof whitePapersTable.$inferSelect;
export type InsertWhitePaper = typeof whitePapersTable.$inferInsert;
