import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const COLLATERAL_TYPES = [
  "webinar",
  "white_paper",
  "case_study",
  "podcast",
  "model",
  "training",
  "event",
  "insight",
  "video",
] as const;
export type CollateralType = (typeof COLLATERAL_TYPES)[number];

export const collateralTypeEnum = pgEnum("collateral_type", COLLATERAL_TYPES);

export const COLLATERAL_PILLARS = [
  "strategic",
  "technology",
  "experiences",
  "gtm",
] as const;
export type CollateralPillar = (typeof COLLATERAL_PILLARS)[number];

export const collateralPillarEnum = pgEnum("collateral_pillar", COLLATERAL_PILLARS);

export const collateralTable = pgTable(
  "collateral",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    type: collateralTypeEnum("type").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    description: text("description").notNull().default(""),
    heroImage: text("hero_image").notNull().default(""),
    pillar: collateralPillarEnum("pillar"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    url: text("url").notNull().default(""),
    external: boolean("external").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    featured: boolean("featured").notNull().default(false),
    featuredRank: integer("featured_rank"),
    videoUrl: text("video_url"),
    downloadUrl: text("download_url"),
    active: boolean("active").notNull().default(true),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("collateral_slug_key").on(t.slug),
    index("collateral_type_idx").on(t.type),
    index("collateral_pillar_idx").on(t.pillar),
    index("collateral_featured_rank_idx").on(t.featured, t.featuredRank),
    index("collateral_published_at_idx").on(t.publishedAt),
  ],
);

export const collateralRelations = relations(collateralTable, () => ({}));

export type Collateral = typeof collateralTable.$inferSelect;
export type InsertCollateral = typeof collateralTable.$inferInsert;
