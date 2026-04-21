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

export const wixRedirectsTable = pgTable(
  "wix_redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourcePath: text("source_path").notNull(),
    targetPath: text("target_path").notNull(),
    statusCode: integer("status_code").notNull().default(301),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    hitCount: integer("hit_count").notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("wix_redirects_source_path_key").on(t.sourcePath),
    index("wix_redirects_active_idx").on(t.active),
  ],
);

export type WixRedirect = typeof wixRedirectsTable.$inferSelect;
export type InsertWixRedirect = typeof wixRedirectsTable.$inferInsert;
