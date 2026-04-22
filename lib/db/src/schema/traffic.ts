import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
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
  },
  (t) => [
    index("traffic_sessions_first_seen_idx").on(t.firstSeenAt),
    index("traffic_sessions_is_bot_idx").on(t.isBot, t.firstSeenAt),
    index("traffic_sessions_country_idx").on(t.country),
    index("traffic_sessions_source_idx").on(t.trafficSource),
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
  },
  (t) => [
    index("traffic_pageviews_session_idx").on(t.sessionId),
    index("traffic_pageviews_viewed_at_idx").on(t.viewedAt),
    index("traffic_pageviews_path_viewed_at_idx").on(t.path, t.viewedAt),
    index("traffic_pageviews_page_type_idx").on(t.pageType, t.viewedAt),
  ],
);

export const trafficSessionsRelations = relations(trafficSessionsTable, ({ many }) => ({
  pageviews: many(trafficPageviewsTable),
}));

export const trafficPageviewsRelations = relations(trafficPageviewsTable, ({ one }) => ({
  session: one(trafficSessionsTable, {
    fields: [trafficPageviewsTable.sessionId],
    references: [trafficSessionsTable.id],
  }),
}));

export type TrafficSession = typeof trafficSessionsTable.$inferSelect;
export type InsertTrafficSession = typeof trafficSessionsTable.$inferInsert;
export type TrafficPageview = typeof trafficPageviewsTable.$inferSelect;
export type InsertTrafficPageview = typeof trafficPageviewsTable.$inferInsert;
