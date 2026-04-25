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
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { servicesTable, solutionsTable } from "./services";
import { polarisEpisodesTable } from "./polarisEpisodes";
import {
  COLLATERAL_PILLARS,
  collateralPillarEnum,
  type CollateralPillar,
} from "./_artifactBase";

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
  "ebook",
  "application",
] as const;
export type CollateralType = (typeof COLLATERAL_TYPES)[number];

export const collateralTypeEnum = pgEnum("collateral_type", COLLATERAL_TYPES);

// Re-export pillar enum for back-compat with modules importing it from
// collateral.ts. Canonical home is now _artifactBase.ts.
export { COLLATERAL_PILLARS, collateralPillarEnum };
export type { CollateralPillar };

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
    // Primary service / solution relationship (#100). Nullable because not
    // every collateral item is tied to a specific offering (e.g. general
    // insights posts). For items that belong to multiple services, use
    // the collateralServices join table.
    serviceId: uuid("service_id").references(() => servicesTable.id, {
      onDelete: "set null",
    }),
    solutionId: uuid("solution_id").references(() => solutionsTable.id, {
      onDelete: "set null",
    }),
    active: boolean("active").notNull().default(true),
    sourceId: text("source_id"),
    // Link back to the Polaris episode that was synced into this collateral
    // entry. Nullable — only set for podcast entries created via the episode
    // editor's "Add to Library" / "Sync" action. Cascades to null on episode
    // delete so the collateral entry survives as a standalone record.
    polarisEpisodeId: uuid("polaris_episode_id").references(
      () => polarisEpisodesTable.id,
      { onDelete: "set null" },
    ),
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
    index("collateral_service_idx").on(t.serviceId),
    index("collateral_solution_idx").on(t.solutionId),
    index("collateral_polaris_episode_idx").on(t.polarisEpisodeId),
  ],
);

// Secondary many-to-many: a single collateral item can relate to multiple
// services (e.g. a cross-functional case study). The primary service
// should still be set on `collateralTable.serviceId` so rails keep a
// single canonical service.
export const collateralServicesTable = pgTable(
  "collateral_services",
  {
    collateralId: uuid("collateral_id")
      .notNull()
      .references(() => collateralTable.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => servicesTable.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.collateralId, t.serviceId] }),
    index("collateral_services_service_idx").on(t.serviceId),
  ],
);

export const collateralRelations = relations(collateralTable, ({ one, many }) => ({
  service: one(servicesTable, {
    fields: [collateralTable.serviceId],
    references: [servicesTable.id],
  }),
  solution: one(solutionsTable, {
    fields: [collateralTable.solutionId],
    references: [solutionsTable.id],
  }),
  additionalServices: many(collateralServicesTable),
}));

export const collateralServicesRelations = relations(collateralServicesTable, ({ one }) => ({
  collateral: one(collateralTable, {
    fields: [collateralServicesTable.collateralId],
    references: [collateralTable.id],
  }),
  service: one(servicesTable, {
    fields: [collateralServicesTable.serviceId],
    references: [servicesTable.id],
  }),
}));

export type Collateral = typeof collateralTable.$inferSelect;
export type InsertCollateral = typeof collateralTable.$inferInsert;
export type CollateralServiceLink = typeof collateralServicesTable.$inferSelect;
