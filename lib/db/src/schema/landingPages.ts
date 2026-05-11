import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  artifactStatusEnum,
  collateralPillarEnum,
  type ArtifactStatus,
} from "./_artifactBase";
import { servicesTable, solutionsTable } from "./services";

// Composable, DB-backed landing pages (e.g. /ai-training).
//
// Each row is one URL claimable at the site root: `slug` becomes the path
// segment (no leading slash). Content is a typed array of "blocks" stored
// as JSON so editors can compose hero / rich-text / card-grid / cta / image
// / faq sections without code changes.
//
// Classification columns (`featured`, `featuredRank`, `pillar`, `serviceId`,
// `solutionId`, `active`, `unpublishedAt`, `sourceId`, `tags`) mirror the
// shared #98 artifact pattern so landing pages can participate in the same
// surfaces as posts, white papers, applications, etc. — featured carousel,
// /library, service/solution-filtered rails, and the polymorphic taxonomy
// (categories/tags) join via `entityType = 'landing_page'`.
export const landingPagesTable = pgTable(
  "landing_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    // Short editorial blurb used by carousel cards, library tiles, and
    // related-content rails when this page is surfaced outside its own URL.
    // Distinct from `seoDescription`, which is meta-only.
    subtitle: text("subtitle"),
    description: text("description").notNull().default(""),
    heroImage: text("hero_image").notNull().default(""),
    status: artifactStatusEnum("status").notNull().default("draft"),
    blocks: jsonb("blocks").notNull().default([]),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    seoCanonicalUrl: text("seo_canonical_url"),
    ogImageUrl: text("og_image_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
    // Classification — same shape as other artifact types. Featured pages
    // participate in /api/collateral/featured (home carousel) and the
    // /library listings when synced into the collateral table.
    featured: boolean("featured").notNull().default(false),
    featuredRank: integer("featured_rank"),
    pillar: collateralPillarEnum("pillar"),
    serviceId: uuid("service_id").references(() => servicesTable.id, {
      onDelete: "set null",
    }),
    solutionId: uuid("solution_id").references(() => solutionsTable.id, {
      onDelete: "set null",
    }),
    // Tags as a denormalised string array — mirrors `collateral.tags`. The
    // polymorphic `entity_tags` table is the authoritative join when an
    // editor manages tags via the shared taxonomy admin; this column is
    // kept in sync for carousel/library cards that read tags off the row.
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // `active` is independent of `status` so an editor can temporarily
    // hide a published page from rails (e.g. event over) without losing
    // the publishedAt anchor or moving the row to archived.
    active: boolean("active").notNull().default(true),
    // Stable identifier for legacy / external sources (CSV imports, source
    // systems). Nullable; uniqueness only enforced when set.
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("landing_pages_slug_key").on(t.slug),
    uniqueIndex("landing_pages_source_id_key").on(t.sourceId),
    index("landing_pages_status_idx").on(t.status),
    index("landing_pages_featured_rank_idx").on(t.featured, t.featuredRank),
    index("landing_pages_pillar_idx").on(t.pillar),
    index("landing_pages_service_idx").on(t.serviceId),
    index("landing_pages_solution_idx").on(t.solutionId),
    index("landing_pages_published_at_idx").on(t.publishedAt),
  ],
);

export const landingPagesRelations = relations(landingPagesTable, ({ one }) => ({
  service: one(servicesTable, {
    fields: [landingPagesTable.serviceId],
    references: [servicesTable.id],
  }),
  solution: one(solutionsTable, {
    fields: [landingPagesTable.solutionId],
    references: [solutionsTable.id],
  }),
}));

export type LandingPage = typeof landingPagesTable.$inferSelect;
export type InsertLandingPage = typeof landingPagesTable.$inferInsert;

// Status values are inherited from the shared artifact enum so landing
// pages share the draft / scheduled / published / archived lifecycle with
// every other CMS type. Kept as a re-export so callers can `import { LANDING_PAGE_STATUSES }`
// without taking a direct dep on `_artifactBase.ts`.
export const LANDING_PAGE_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "archived",
] as const;
export type LandingPageStatus = ArtifactStatus;

// ---------------------------------------------------------------------------
// Block payload shapes
//
// Blocks are stored as `{ type, ...fields }` in the `blocks` JSON array.
// Adding a new block type is a one-file change: add the discriminant +
// payload here, then teach the public renderer and admin editor about it.
// ---------------------------------------------------------------------------

export type LandingPageCTA = {
  label: string;
  href: string;
  variant?: "primary" | "secondary";
};

export type HeroBlock = {
  type: "hero";
  eyebrow?: string | null;
  title: string;
  subtitle?: string | null;
  theme?: "nebula" | "light" | null;
};

export type RichTextBlock = {
  type: "richText";
  heading?: string | null;
  bodyHtml: string;
};

export type CardGridBlockCard = {
  code?: string | null;
  title: string;
  description?: string | null;
  level?: string | null;
  url?: string | null;
  source?: string | null;
};

export type CardGridBlock = {
  type: "cardGrid";
  heading?: string | null;
  intro?: string | null;
  cards: CardGridBlockCard[];
};

export type CtaBlock = {
  type: "cta";
  heading: string;
  body?: string | null;
  buttons: LandingPageCTA[];
  theme?: "nebula" | "light" | null;
};

export type ImageBlock = {
  type: "image";
  url: string;
  alt?: string | null;
  caption?: string | null;
};

export type FaqBlock = {
  type: "faq";
  heading?: string | null;
  items: { q: string; a: string }[];
};

export type LandingPageBlock =
  | HeroBlock
  | RichTextBlock
  | CardGridBlock
  | CtaBlock
  | ImageBlock
  | FaqBlock;

export const LANDING_PAGE_BLOCK_TYPES = [
  "hero",
  "richText",
  "cardGrid",
  "cta",
  "image",
  "faq",
] as const;
export type LandingPageBlockType = (typeof LANDING_PAGE_BLOCK_TYPES)[number];

export function isLandingPagePubliclyVisible(
  row: Pick<
    LandingPage,
    "status" | "deletedAt" | "publishedAt" | "unpublishedAt" | "active"
  >,
  now: Date = new Date(),
): boolean {
  if (row.deletedAt) return false;
  if (!row.active) return false;
  if (row.status !== "published") return false;
  if (row.publishedAt && row.publishedAt > now) return false;
  if (row.unpublishedAt && row.unpublishedAt <= now) return false;
  return true;
}

// Drizzle infers `blocks` as `unknown` because of `.default([])`. Callers
// almost always want the typed view; this cast helper keeps the call sites
// terse and gives one place to widen if we ever add a discriminator at the
// edges (zod parse, runtime validation).
export function landingPageBlocks(row: LandingPage): LandingPageBlock[] {
  return (row.blocks ?? []) as LandingPageBlock[];
}
