import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Composable, DB-backed landing pages (e.g. /ai-training).
//
// Each row is one URL claimable at the site root: `slug` becomes the path
// segment (no leading slash). Content is a typed array of "blocks" stored
// as JSON so editors can compose hero / rich-text / card-grid / cta / image
// / faq sections without code changes.
//
// Status follows the same draft / published lifecycle as the rest of the
// CMS but kept on this table (rather than the shared artifact base) since
// landing pages don't share the featured / pillar / source-id semantics.
export const landingPagesTable = pgTable(
  "landing_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    blocks: jsonb("blocks").notNull().default([]),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    seoCanonicalUrl: text("seo_canonical_url"),
    ogImageUrl: text("og_image_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("landing_pages_slug_key").on(t.slug),
    index("landing_pages_status_idx").on(t.status),
  ],
);

export type LandingPage = typeof landingPagesTable.$inferSelect;
export type InsertLandingPage = typeof landingPagesTable.$inferInsert;

export const LANDING_PAGE_STATUSES = ["draft", "published", "archived"] as const;
export type LandingPageStatus = (typeof LANDING_PAGE_STATUSES)[number];

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
  row: Pick<LandingPage, "status" | "deletedAt" | "publishedAt">,
  now: Date = new Date(),
): boolean {
  if (row.deletedAt) return false;
  if (row.status !== "published") return false;
  if (row.publishedAt && row.publishedAt > now) return false;
  return true;
}

// Drizzle infers `blocks` as `unknown` because of `.default([])`. Callers
// almost always want the typed view; this cast helper keeps the call sites
// terse and gives one place to widen if we ever add a discriminator at the
// edges (zod parse, runtime validation).
export function landingPageBlocks(row: LandingPage): LandingPageBlock[] {
  return (row.blocks ?? []) as LandingPageBlock[];
}
