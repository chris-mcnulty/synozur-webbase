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

export const VIDEO_CATEGORIES = [
  "interview",
  "webinar",
  "demo",
  "talk",
  "clip",
  "other",
] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export const videoCategoryEnum = pgEnum("video_category", VIDEO_CATEGORIES);

export const VIDEO_STATUSES = ["draft", "published", "archived"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const videoStatusEnum = pgEnum("video_status", VIDEO_STATUSES);

export const videosTable = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    category: videoCategoryEnum("category").notNull().default("webinar"),
    videoUrl: text("video_url").notNull().default(""),
    thumbnailUrl: text("thumbnail_url"),
    heroImage: text("hero_image").notNull().default(""),
    heroImageAlt: text("hero_image_alt"),
    shortDescription: text("short_description").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    pillar: text("pillar"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    status: videoStatusEnum("status").notNull().default("draft"),
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
    uniqueIndex("videos_slug_key").on(t.slug),
    uniqueIndex("videos_source_id_key").on(t.sourceId),
    index("videos_category_idx").on(t.category),
    index("videos_status_idx").on(t.status),
    index("videos_published_at_idx").on(t.publishedAt),
    index("videos_featured_rank_idx").on(t.featured, t.featuredRank),
  ],
);

export type Video = typeof videosTable.$inferSelect;
export type InsertVideo = typeof videosTable.$inferInsert;
