import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";
import { mediaTable } from "./media";

export const POST_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const postStatusEnum = pgEnum("post_status", POST_STATUSES);

export const postsTable = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    bodyHtml: text("body_html"),
    bodyMarkdown: text("body_markdown"),
    excerpt: text("excerpt"),
    heroImageId: uuid("hero_image_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    status: postStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    seoCanonicalUrl: text("seo_canonical_url"),
    ogImageId: uuid("og_image_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    readingTimeMin: integer("reading_time_min"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("posts_slug_key").on(t.slug),
    index("posts_status_published_at_idx").on(t.status, t.publishedAt),
    index("posts_status_scheduled_for_idx").on(t.status, t.scheduledFor),
  ],
);

export const revisionsTable = pgTable("revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => postsTable.id, { onDelete: "cascade" }),
  snapshotJson: jsonb("snapshot_json").notNull(),
  editedBy: uuid("edited_by").references(() => usersTable.id, { onDelete: "set null" }),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
});

export const postsRelations = relations(postsTable, ({ one, many }) => ({
  author: one(usersTable, { fields: [postsTable.authorId], references: [usersTable.id] }),
  heroImage: one(mediaTable, { fields: [postsTable.heroImageId], references: [mediaTable.id] }),
  ogImage: one(mediaTable, { fields: [postsTable.ogImageId], references: [mediaTable.id] }),
  revisions: many(revisionsTable),
}));

export type Post = typeof postsTable.$inferSelect;
export type InsertPost = typeof postsTable.$inferInsert;
export type Revision = typeof revisionsTable.$inferSelect;
