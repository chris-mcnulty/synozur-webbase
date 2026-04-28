import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const trafficSessionsTable = pgTable(
  "traffic_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionHash: text("session_hash").notNull().unique(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    pageviewCount: integer("pageview_count").notNull().default(0),

    userAgent: text("user_agent"),
    browserName: text("browser_name"),
    browserVersion: text("browser_version"),
    osName: text("os_name"),
    deviceType: text("device_type"), // desktop | mobile | tablet | bot

    ipHash: text("ip_hash").notNull(),
    country: text("country"),
    region: text("region"),
    city: text("city"),

    // Entry-point attribution. Captured from the FIRST pageview.
    landingPath: text("landing_path"),
    referrerUrl: text("referrer_url"),
    referrerHost: text("referrer_host"),
    trafficSource: text("traffic_source"), // direct | organic | ai | referral | social | paid | internal
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),

    isBot: boolean("is_bot").notNull().default(false),
    botCategory: text("bot_category"), // ai | search | social | other
    botName: text("bot_name"),

    // Provenance. `native` is the live first-party tracker; `wix` (and any
    // future legacy source) is bulk-imported from an analytics export. The
    // column lets reporting filter to a single source while letting YTD
    // dashboards include everything by default.
    sourceSystem: text("source_system").notNull().default("native"),
    importBatchId: uuid("import_batch_id"),
    // Stable per-row key for legacy imports so re-running the same export is
    // idempotent. Populated only when sourceSystem != 'native'.
    legacySessionKey: text("legacy_session_key"),
  },
  (t) => [
    index("traffic_sessions_first_seen_idx").on(t.firstSeenAt),
    index("traffic_sessions_is_bot_idx").on(t.isBot, t.firstSeenAt),
    index("traffic_sessions_country_idx").on(t.country),
    index("traffic_sessions_source_idx").on(t.trafficSource),
    index("traffic_sessions_source_system_idx").on(t.sourceSystem, t.firstSeenAt),
    uniqueIndex("traffic_sessions_legacy_session_key_key").on(t.legacySessionKey),
  ],
);

export const trafficPageviewsTable = pgTable(
  "traffic_pageviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trafficSessionsTable.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),

    path: text("path").notNull(),
    pageType: text("page_type"), // home | insights | insight-detail | service | case-study | application | ...
    title: text("title"),

    referrerUrl: text("referrer_url"),
    referrerHost: text("referrer_host"),

    // Populated lazily by a client beacon on unload. Nullable.
    timeOnPageMs: integer("time_on_page_ms"),
    scrollDepthPct: integer("scroll_depth_pct"),

    // See trafficSessionsTable.sourceSystem. A pageview row mirrors its
    // session's provenance, denormalized so reporting queries don't need to
    // join the sessions table just to filter by source.
    sourceSystem: text("source_system").notNull().default("native"),
    importBatchId: uuid("import_batch_id"),
    // For legacy imports each Wix detail row already aggregates multiple
    // pageviews of the same path within a session. Storing the count rather
    // than expanding to N rows keeps the table size bounded.
    pageviewCount: integer("pageview_count").notNull().default(1),
    // Resolved new-platform path (after wix_redirects). Nullable when the
    // legacy path doesn't map cleanly; reporting can fall back to `path`.
    resolvedPath: text("resolved_path"),
  },
  (t) => [
    index("traffic_pageviews_session_idx").on(t.sessionId),
    index("traffic_pageviews_viewed_at_idx").on(t.viewedAt),
    index("traffic_pageviews_path_viewed_at_idx").on(t.path, t.viewedAt),
    index("traffic_pageviews_page_type_idx").on(t.pageType, t.viewedAt),
    index("traffic_pageviews_source_system_idx").on(t.sourceSystem, t.viewedAt),
    index("traffic_pageviews_resolved_path_idx").on(t.resolvedPath, t.viewedAt),
  ],
);

/**
 * Custom events fired from the first-party tracker (form submits, CTA clicks,
 * resource downloads, …). Keyed off the parent session so segmentation by
 * device/country/source joins naturally.
 */
export const trafficEventsTable = pgTable(
  "traffic_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trafficSessionsTable.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    path: text("path").notNull(),
    eventName: text("event_name").notNull(),
    properties: jsonb("properties"),
  },
  (t) => [
    index("traffic_events_session_idx").on(t.sessionId),
    index("traffic_events_occurred_at_idx").on(t.occurredAt),
    index("traffic_events_event_name_idx").on(t.eventName, t.occurredAt),
  ],
);

export const trafficSessionsRelations = relations(trafficSessionsTable, ({ many }) => ({
  pageviews: many(trafficPageviewsTable),
  events: many(trafficEventsTable),
}));

export const trafficPageviewsRelations = relations(trafficPageviewsTable, ({ one }) => ({
  session: one(trafficSessionsTable, {
    fields: [trafficPageviewsTable.sessionId],
    references: [trafficSessionsTable.id],
  }),
}));

export const trafficEventsRelations = relations(trafficEventsTable, ({ one }) => ({
  session: one(trafficSessionsTable, {
    fields: [trafficEventsTable.sessionId],
    references: [trafficSessionsTable.id],
  }),
}));

export type TrafficSession = typeof trafficSessionsTable.$inferSelect;
export type InsertTrafficSession = typeof trafficSessionsTable.$inferInsert;
export type TrafficPageview = typeof trafficPageviewsTable.$inferSelect;
export type InsertTrafficPageview = typeof trafficPageviewsTable.$inferInsert;
export type TrafficEvent = typeof trafficEventsTable.$inferSelect;
export type InsertTrafficEvent = typeof trafficEventsTable.$inferInsert;
