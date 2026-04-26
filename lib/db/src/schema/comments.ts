import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  jsonb,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { postsTable } from "./posts";
import { usersTable } from "./users";

export const COMMENT_STATUSES = ["pending", "approved", "spam", "deleted"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const commentStatusEnum = pgEnum("comment_status", COMMENT_STATUSES);

export const commentsTable = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    parentCommentId: uuid("parent_comment_id").references(
      (): AnyPgColumn => commentsTable.id,
      { onDelete: "cascade" },
    ),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    bodyText: text("body_text").notNull(),
    status: commentStatusEnum("status").notNull().default("pending"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    moderatedBy: uuid("moderated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    // #53: visitor opt-in for transactional email notifications. Each flag
    // is captured at submission time. `notifiedApprovedAt` is stamped when
    // the approval email is sent so re-moderation (approve → unapprove →
    // approve) doesn't spam the commenter.
    notifyOnApproval: boolean("notify_on_approval").notNull().default(false),
    notifyOnReply: boolean("notify_on_reply").notNull().default(false),
    notifiedApprovedAt: timestamp("notified_approved_at", { withTimezone: true }),
    // #54: spam scorer signals. Stored as a JSON array of signal strings so
    // admins can see exactly why the scorer flagged the comment. null means
    // the scorer was not run (e.g. before this feature was deployed).
    spamSignals: jsonb("spam_signals").$type<string[]>(),
  },
  (t) => [
    index("comments_post_status_idx").on(t.postId, t.status),
    index("comments_parent_idx").on(t.parentCommentId),
  ],
);

export const commentsRelations = relations(commentsTable, ({ one, many }) => ({
  post: one(postsTable, { fields: [commentsTable.postId], references: [postsTable.id] }),
  parent: one(commentsTable, {
    fields: [commentsTable.parentCommentId],
    references: [commentsTable.id],
    relationName: "parent",
  }),
  replies: many(commentsTable, { relationName: "parent" }),
  moderator: one(usersTable, {
    fields: [commentsTable.moderatedBy],
    references: [usersTable.id],
  }),
}));

export type Comment = typeof commentsTable.$inferSelect;
export type InsertComment = typeof commentsTable.$inferInsert;
