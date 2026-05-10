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
import { usersTable } from "./users";

// Branded short links served from `aka.synozur.com/<slug>`. Modeled after the
// Rebrandly export so a CSV round-trips without information loss: slug,
// destination, optional title/notes/tags, and the originating Rebrandly id
// (kept so re-importing the same export updates rows in place instead of
// duplicating them).
export const shortLinksTable = pgTable(
  "short_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lower-cased; matched case-insensitively at redirect time.
    slug: text("slug").notNull(),
    targetUrl: text("target_url").notNull(),
    title: text("title"),
    notes: text("notes"),
    // Rebrandly defaults to 302; allow 301/307/308 for callers that need
    // permanence or method preservation. Keep parity with wixRedirects.
    statusCode: integer("status_code").notNull().default(302),
    active: boolean("active").notNull().default(true),
    // Free-form labels imported from Rebrandly's `tags` column.
    tags: text("tags").array(),
    // Denormalized counters so list views don't need a per-row aggregate.
    // The audit trail lives in `short_link_clicks`.
    hitCount: integer("hit_count").notNull().default(0),
    lastClickAt: timestamp("last_click_at", { withTimezone: true }),
    // Carried from Rebrandly exports so re-imports are idempotent.
    rebrandlyId: text("rebrandly_id"),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("short_links_slug_key").on(t.slug),
    index("short_links_active_idx").on(t.active),
    index("short_links_rebrandly_idx").on(t.rebrandlyId),
  ],
);

// Per-click audit trail. The redirect middleware fires-and-forgets an insert
// here so the redirect itself stays sub-10ms; the row is later joinable
// against `traffic_sessions` via `sessionHash` for richer reporting.
export const shortLinkClicksTable = pgTable(
  "short_link_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shortLinkId: uuid("short_link_id")
      .notNull()
      .references(() => shortLinksTable.id, { onDelete: "cascade" }),
    clickedAt: timestamp("clicked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // SHA-256 of (raw IP + server-side salt). Preserves per-session
    // uniqueness for reporting without storing PII at rest.
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    referrer: text("referrer"),
    // 2-letter country code if the upstream proxy passes one (e.g. via
    // `cf-ipcountry`). NULL when geo isn't available.
    country: text("country"),
    sessionHash: text("session_hash"),
  },
  (t) => [
    index("short_link_clicks_link_idx").on(t.shortLinkId),
    index("short_link_clicks_clicked_at_idx").on(t.clickedAt),
  ],
);

export type ShortLink = typeof shortLinksTable.$inferSelect;
export type InsertShortLink = typeof shortLinksTable.$inferInsert;
export type ShortLinkClick = typeof shortLinkClicksTable.$inferSelect;
export type InsertShortLinkClick = typeof shortLinkClicksTable.$inferInsert;
