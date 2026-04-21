import {
  boolean,
  integer,
  pgEnum,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Shared lifecycle used by every artifact type (posts, videos, white_papers,
// workshops, applications, case_studies, polaris_episodes, etc.). Declared
// once so adding a new artifact type (e.g. Offices) is not a ~6-file exercise.
export const ARTIFACT_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const artifactStatusEnum = pgEnum("artifact_status", ARTIFACT_STATUSES);

// Column builders grouped as object literals. Drizzle's pgTable accepts
// spread object literals, so an artifact-type table declaration looks like:
//
//   export const officesTable = pgTable("offices", {
//     ...artifactIdentity,
//     city: text("city").notNull(),
//     ...artifactLifecycle,
//     ...artifactTimestamps,
//   }, (t) => [...artifactBaseIndexes(t, "offices")]);
//
// Each group is intentionally small so a caller can opt in or out.

export const artifactIdentity = {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
};

export const artifactLifecycle = {
  status: artifactStatusEnum("status").notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
  featured: boolean("featured").notNull().default(false),
  featuredRank: integer("featured_rank"),
  active: boolean("active").notNull().default(true),
  sourceId: text("source_id"),
};

export const artifactSeo = {
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  ogImage: text("og_image"),
};

export const artifactTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// Runtime descriptor for an artifact type. Consumed by the route factory
// and the sync-to-collateral helper. `entityType` must match the value in
// `entity_type` polymorphic taxonomy joins — see `TAXONOMY_ENTITY_TYPES`
// in `schema/taxonomy.ts` for the canonical list.
export type ArtifactBaseRow = {
  id: string;
  slug: string;
  title: string;
  status: ArtifactStatus;
  publishedAt: Date | null;
  unpublishedAt: Date | null;
  featured: boolean;
  featuredRank: number | null;
  active: boolean;
  sourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export function isArtifactPubliclyVisible(row: ArtifactBaseRow, now: Date = new Date()): boolean {
  if (row.deletedAt) return false;
  if (!row.active) return false;
  if (row.status !== "published") return false;
  if (row.publishedAt && row.publishedAt > now) return false;
  if (row.unpublishedAt && row.unpublishedAt <= now) return false;
  return true;
}
