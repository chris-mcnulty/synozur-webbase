// #160 — Search Console / Bing index-coverage tracking.
//
// One `seo_coverage_status` row per published canonical URL, refreshed by a
// daily cron that calls the Google Search Console URL Inspection API and the
// Bing Webmaster GetUrlInfo API. The admin dashboard at
// /admin/marketing/seo-coverage aggregates these rows into per-artifact-type
// buckets (indexed / discovered-not-indexed / crawl-error / soft-404) so
// editors can tell at a glance whether a published page has actually made it
// into the index.
//
// `seo_coverage_runs` records each scan so the dashboard can surface the
// last-run timestamp and whether each provider was configured.

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const seoCoverageStatusTable = pgTable(
  "seo_coverage_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Absolute canonical URL (origin + path). Unique — one row per URL.
    url: text("url").notNull().unique(),
    // Relative path, kept for display + classification.
    path: text("path").notNull(),
    // Artifact kind derived from the path prefix (insight, service, …).
    artifactKind: text("artifact_kind").notNull(),

    // Normalized Google bucket: indexed | discovered-not-indexed |
    // crawl-error | soft-404 | unknown | not-configured | error.
    googleBucket: text("google_bucket"),
    googleCoverageState: text("google_coverage_state"),
    googleVerdict: text("google_verdict"),
    googleLastCrawlAt: timestamp("google_last_crawl_at", { withTimezone: true }),
    googleRaw: jsonb("google_raw"),

    // Bing is best-effort (the Webmaster API exposes less than Search
    // Console). Same bucket vocabulary; degrades to not-configured / error.
    bingBucket: text("bing_bucket"),
    bingHttpStatus: integer("bing_http_status"),
    bingLastCrawlAt: timestamp("bing_last_crawl_at", { withTimezone: true }),
    bingRaw: jsonb("bing_raw"),

    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("seo_coverage_status_kind_idx").on(t.artifactKind),
    index("seo_coverage_status_google_bucket_idx").on(t.googleBucket),
    index("seo_coverage_status_checked_idx").on(t.lastCheckedAt),
  ],
);

export const seoCoverageRunsTable = pgTable(
  "seo_coverage_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // "scheduled" | "manual"
    trigger: text("trigger").notNull().default("scheduled"),
    urlCount: integer("url_count").notNull().default(0),
    googleConfigured: boolean("google_configured").notNull().default(false),
    bingConfigured: boolean("bing_configured").notNull().default(false),
    googleChecked: integer("google_checked").notNull().default(0),
    bingChecked: integer("bing_checked").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("seo_coverage_runs_started_idx").on(t.startedAt)],
);

export type SeoCoverageStatus = typeof seoCoverageStatusTable.$inferSelect;
export type InsertSeoCoverageStatus =
  typeof seoCoverageStatusTable.$inferInsert;
export type SeoCoverageRun = typeof seoCoverageRunsTable.$inferSelect;
export type InsertSeoCoverageRun = typeof seoCoverageRunsTable.$inferInsert;
