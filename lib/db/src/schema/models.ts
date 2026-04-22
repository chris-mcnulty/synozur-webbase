import {
  pgTable,
  text,
  jsonb,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { servicesTable, solutionsTable } from "./services";
import {
  artifactIdentity,
  artifactLifecycle,
  artifactSeo,
  artifactTimestamps,
  collateralPillarEnum,
} from "./_artifactBase";

// Maturity models (#106). Replaces the Wix CMS rows and the single
// hand-entered collateral row with a dedicated artifact table. Each row
// powers a public /models/:slug detail page; editors can also feature
// models so they appear in the library carousel via the syncCollateral
// pipeline. `launchUrl` is opened as a new-tab CTA to the external
// assessment app (e.g. orion.synozur.com or aimaturity.synozur.com).

export type ModelRelatedItem = {
  label: string;
  url: string;
  kind?: "link" | "white-paper" | "video" | "case-study";
};

export const modelsTable = pgTable(
  "models",
  {
    ...artifactIdentity,
    shortDescription: text("short_description").notNull().default(""),
    heroImage: text("hero_image").notNull().default(""),
    longDescriptionHtml: text("long_description_html").notNull().default(""),
    dimensionsHtml: text("dimensions_html").notNull().default(""),
    launchUrl: text("launch_url").notNull().default(""),
    relatedInformation: jsonb("related_information")
      .$type<ModelRelatedItem[]>()
      .notNull()
      .default([]),
    pillar: collateralPillarEnum("pillar"),
    serviceId: uuid("service_id").references(() => servicesTable.id, {
      onDelete: "set null",
    }),
    solutionId: uuid("solution_id").references(() => solutionsTable.id, {
      onDelete: "set null",
    }),
    ...artifactLifecycle,
    ...artifactSeo,
    ...artifactTimestamps,
  },
  (t) => [
    uniqueIndex("models_slug_key").on(t.slug),
    uniqueIndex("models_source_id_key").on(t.sourceId),
    index("models_status_idx").on(t.status),
    index("models_published_at_idx").on(t.publishedAt),
    index("models_featured_rank_idx").on(t.featured, t.featuredRank),
    index("models_pillar_idx").on(t.pillar),
    index("models_service_idx").on(t.serviceId),
    index("models_solution_idx").on(t.solutionId),
  ],
);

export const modelsRelations = relations(modelsTable, ({ one }) => ({
  service: one(servicesTable, {
    fields: [modelsTable.serviceId],
    references: [servicesTable.id],
  }),
  solution: one(solutionsTable, {
    fields: [modelsTable.solutionId],
    references: [solutionsTable.id],
  }),
}));

export type Model = typeof modelsTable.$inferSelect;
export type InsertModel = typeof modelsTable.$inferInsert;
