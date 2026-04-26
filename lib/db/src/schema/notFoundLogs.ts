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

/**
 * Aggregated record of every distinct path that has rendered the 404 page.
 * One row per normalized path; hit_count and last_seen_at are bumped on
 * subsequent misses so the admin can sort by frequency and decide which
 * paths deserve a redirect.
 */
export const notFoundLogsTable = pgTable(
  "not_found_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lowercased, trailing-slash-stripped path used as the dedupe key.
    normalizedPath: text("normalized_path").notNull(),
    // Last raw path observed (preserves casing for the admin display).
    path: text("path").notNull(),
    hitCount: integer("hit_count").notNull().default(1),
    lastReferrer: text("last_referrer"),
    lastUserAgent: text("last_user_agent"),
    resolved: boolean("resolved").notNull().default(false),
    notes: text("notes"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("not_found_logs_normalized_path_key").on(t.normalizedPath),
    index("not_found_logs_resolved_idx").on(t.resolved, t.lastSeenAt),
    index("not_found_logs_hit_count_idx").on(t.hitCount),
  ],
);

export type NotFoundLog = typeof notFoundLogsTable.$inferSelect;
export type InsertNotFoundLog = typeof notFoundLogsTable.$inferInsert;
