import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { postsTable } from "./posts";

export const postViewsTable = pgTable(
  "post_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
    sessionHash: text("session_hash"),
    referrerHost: text("referrer_host"),
    referrerUrl: text("referrer_url"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("post_views_post_viewed_at_idx").on(t.postId, t.viewedAt),
    index("post_views_viewed_at_idx").on(t.viewedAt),
  ],
);

export const postViewsRelations = relations(postViewsTable, ({ one }) => ({
  post: one(postsTable, { fields: [postViewsTable.postId], references: [postsTable.id] }),
}));

export type PostView = typeof postViewsTable.$inferSelect;
export type InsertPostView = typeof postViewsTable.$inferInsert;
