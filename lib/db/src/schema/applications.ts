import {
  pgTable,
  text,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import {
  artifactIdentity,
  artifactLifecycle,
  artifactSeo,
  artifactTimestamps,
} from "./_artifactBase";

// Applications (#103). Moves the 143-line static TS file at
// `artifacts/synozur/src/data/applications.ts` into a DB table built on
// the shared #98 artifact-type pattern. Canonical source of truth for the
// `/applications` list, detail pages, header Resources nav, footer
// Applications column, and the sitemap — all of which previously kept
// their own hand-maintained copy.

export const applicationsTable = pgTable(
  "applications",
  {
    ...artifactIdentity,
    name: text("name").notNull().default(""),
    tagline: text("tagline").notNull().default(""),
    shortSummary: text("short_summary").notNull().default(""),
    descriptionParagraphs: jsonb("description_paragraphs")
      .$type<string[]>()
      .notNull()
      .default([]),
    version: text("version"),
    releaseDate: text("release_date"),
    websiteUrl: text("website_url").notNull().default(""),
    logo: text("logo").notNull().default(""),
    screenshot: text("screenshot").notNull().default(""),
    userGuideUrl: text("user_guide_url"),
    // Controls whether the application shows up in the primary nav /
    // footer / sitemap rails. Not every published app needs to be in
    // the global nav (e.g. a soft-launched beta that still has a
    // public page).
    showInNav: text("show_in_nav").notNull().default("true"),
    ...artifactLifecycle,
    ...artifactSeo,
    ...artifactTimestamps,
  },
  (t) => [
    uniqueIndex("applications_slug_key").on(t.slug),
    uniqueIndex("applications_source_id_key").on(t.sourceId),
    index("applications_published_at_idx").on(t.publishedAt),
    index("applications_featured_rank_idx").on(t.featured, t.featuredRank),
  ],
);

export type Application = typeof applicationsTable.$inferSelect;
export type InsertApplication = typeof applicationsTable.$inferInsert;
