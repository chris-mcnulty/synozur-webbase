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
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
    // When Bing last returned a *successful* verdict for this URL. Bing's
    // API is heavily throttled (~10-40 calls per run), so scans use this to
    // rotate the limited quota across the least-recently-checked URLs.
    bingCheckedAt: timestamp("bing_checked_at", { withTimezone: true }),

    // Updated whenever the URL is present in the current crawlable sitemap.
    // This is intentionally separate from lastCheckedAt so a provider probe
    // cap does not make an unprobed URL look inspected.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
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
    // Durable scan lifecycle heartbeat. This lets any API replica show real
    // progress and distinguish a working scan from one abandoned by a process.
    completedUrlCount: integer("completed_url_count").notNull().default(0),
    lastProgressAt: timestamp("last_progress_at", { withTimezone: true }),
    // Set only when this run actually receives (or skips after) Bing's
    // throttle response. Do not infer throttling from zero successful checks:
    // authentication and other provider errors can also produce zero.
    bingThrottled: boolean("bing_throttled").notNull().default(false),
    // Number of "discovered-not-indexed" URLs resubmitted to search engines
    // after this scan completed. Null for runs that pre-date the feature.
    resubmittedCount: integer("resubmitted_count"),
    error: text("error"),
  },
  (t) => [index("seo_coverage_runs_started_idx").on(t.startedAt)],
);

// One provider-specific snapshot per reporting day. Google snapshots are
// eligible for a whole-site trend only when every current sitemap URL got a
// usable verdict; Bing snapshots remain explicitly partial while its
// rate-limited rotation is still in progress.
export const seoCoverageDailySnapshotsTable = pgTable(
  "seo_coverage_daily_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    // "google" | "bing"
    provider: text("provider").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => seoCoverageRunsTable.id, { onDelete: "cascade" }),
    sitemapUrlCount: integer("sitemap_url_count").notNull(),
    checkedUrlCount: integer("checked_url_count").notNull(),
    indexedUrlCount: integer("indexed_url_count").notNull(),
    discoveredNotIndexedCount: integer("discovered_not_indexed_count")
      .notNull(),
    // A complete snapshot represents a provider verdict for the full current
    // sitemap, not merely a successful partial sample.
    isComplete: boolean("is_complete").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("seo_coverage_daily_snapshots_day_provider_idx").on(
      t.snapshotDate,
      t.provider,
    ),
    index("seo_coverage_daily_snapshots_provider_date_idx").on(
      t.provider,
      t.snapshotDate,
    ),
  ],
);

// A conservative event ledger: a page is only counted as newly indexed when
// a provider previously confirmed it was discovered but not indexed, then
// later confirms it as indexed. Unknown/error → indexed is intentionally not
// counted as a new indexing event because it cannot prove a transition.
export const seoCoverageIndexEventsTable = pgTable(
  "seo_coverage_index_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    provider: text("provider").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => seoCoverageRunsTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    artifactKind: text("artifact_kind").notNull(),
    previousBucket: text("previous_bucket").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("seo_coverage_index_events_day_provider_url_idx").on(
      t.eventDate,
      t.provider,
      t.url,
    ),
    index("seo_coverage_index_events_provider_date_idx").on(
      t.provider,
      t.eventDate,
    ),
  ],
);

// Records which specific URLs were resubmitted to search engines after each
// scan. One row per (run, url) pair. Enables the dashboard to show "these N
// URLs were resubmitted on date X — M are now indexed" by joining against the
// live seo_coverage_status table.
export const seoResubmittedUrlsTable = pgTable(
  "seo_resubmitted_urls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => seoCoverageRunsTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    path: text("path").notNull(),
    artifactKind: text("artifact_kind").notNull(),
    resubmittedAt: timestamp("resubmitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("seo_resubmitted_urls_run_idx").on(t.runId),
    index("seo_resubmitted_urls_url_idx").on(t.url),
  ],
);

export const seoCoverageRunsRelations = relations(
  seoCoverageRunsTable,
  ({ many }) => ({
    resubmittedUrls: many(seoResubmittedUrlsTable),
  }),
);

export const seoResubmittedUrlsRelations = relations(
  seoResubmittedUrlsTable,
  ({ one }) => ({
    run: one(seoCoverageRunsTable, {
      fields: [seoResubmittedUrlsTable.runId],
      references: [seoCoverageRunsTable.id],
    }),
  }),
);

export type SeoCoverageStatus = typeof seoCoverageStatusTable.$inferSelect;
export type InsertSeoCoverageStatus =
  typeof seoCoverageStatusTable.$inferInsert;
export type SeoCoverageRun = typeof seoCoverageRunsTable.$inferSelect;
export type InsertSeoCoverageRun = typeof seoCoverageRunsTable.$inferInsert;
export type SeoResubmittedUrl = typeof seoResubmittedUrlsTable.$inferSelect;
export type InsertSeoResubmittedUrl =
  typeof seoResubmittedUrlsTable.$inferInsert;
