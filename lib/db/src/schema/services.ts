import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { mediaTable } from "./media";

export const servicesTable = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    displayOrder: integer("display_order"),
    iconId: uuid("icon_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    parentServiceId: uuid("parent_service_id").references(
      (): AnyPgColumn => servicesTable.id,
      { onDelete: "set null" },
    ),
    servicePath: text("service_path"),
    overviewPath: text("overview_path"),
    buttonText: text("button_text"),
    heroTextHtml: text("hero_text_html"),
    secondaryTitle: text("secondary_title"),
    secondaryTextHtml: text("secondary_text_html"),
    tertiaryTitle: text("tertiary_title"),
    tertiaryTextHtml: text("tertiary_text_html"),
    blurbHtml: text("blurb_html"),
    blogCategory: text("blog_category"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    sourceId: text("source_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("services_slug_key").on(t.slug),
    uniqueIndex("services_source_id_key").on(t.sourceId),
    index("services_display_order_idx").on(t.displayOrder),
  ],
);

export const solutionsTable = pgTable(
  "solutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    displayOrder: integer("display_order"),
    parentServiceId: uuid("parent_service_id").references(() => servicesTable.id, {
      onDelete: "set null",
    }),
    iconId: uuid("icon_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    routePath: text("route_path"),
    buttonText: text("button_text"),
    heroTextHtml: text("hero_text_html"),
    secondaryTitle: text("secondary_title"),
    secondaryTextHtml: text("secondary_text_html"),
    ourApproachTitle: text("our_approach_title"),
    ourApproachTextHtml: text("our_approach_text_html"),
    blurbHtml: text("blurb_html"),
    blurbCopy: text("blurb_copy"),
    heroTextColor: text("hero_text_color"),
    tagsText: text("tags_text"),
    blogCategory: text("blog_category"),
    blogTag: text("blog_tag"),
    primaryBlogCategoryFilter: text("primary_blog_category_filter"),
    buttonUrl: text("button_url"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    sourceId: text("source_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("solutions_slug_key").on(t.slug),
    uniqueIndex("solutions_source_id_key").on(t.sourceId),
    index("solutions_parent_service_idx").on(t.parentServiceId),
    index("solutions_display_order_idx").on(t.displayOrder),
  ],
);

export const serviceMethodologiesTable = pgTable(
  "service_methodologies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => servicesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    iconId: uuid("icon_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    bodyHtml: text("body_html"),
    hidden: boolean("hidden").notNull().default(false),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("service_methodologies_source_id_key").on(t.sourceId),
    index("service_methodologies_service_idx").on(t.serviceId, t.displayOrder),
  ],
);

export const solutionCapabilitiesTable = pgTable(
  "solution_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    solutionId: uuid("solution_id")
      .notNull()
      .references(() => solutionsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    iconId: uuid("icon_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    bodyHtml: text("body_html"),
    hidden: boolean("hidden").notNull().default(false),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("solution_capabilities_source_id_key").on(t.sourceId),
    index("solution_capabilities_solution_idx").on(t.solutionId, t.displayOrder),
  ],
);

export const servicesRelations = relations(servicesTable, ({ one, many }) => ({
  icon: one(mediaTable, { fields: [servicesTable.iconId], references: [mediaTable.id] }),
  parent: one(servicesTable, {
    fields: [servicesTable.parentServiceId],
    references: [servicesTable.id],
    relationName: "parent_service",
  }),
  children: many(servicesTable, { relationName: "parent_service" }),
  solutions: many(solutionsTable),
  methodologies: many(serviceMethodologiesTable),
}));

export const solutionsRelations = relations(solutionsTable, ({ one, many }) => ({
  icon: one(mediaTable, { fields: [solutionsTable.iconId], references: [mediaTable.id] }),
  parentService: one(servicesTable, {
    fields: [solutionsTable.parentServiceId],
    references: [servicesTable.id],
  }),
  capabilities: many(solutionCapabilitiesTable),
}));

export const serviceMethodologiesRelations = relations(
  serviceMethodologiesTable,
  ({ one }) => ({
    service: one(servicesTable, {
      fields: [serviceMethodologiesTable.serviceId],
      references: [servicesTable.id],
    }),
    icon: one(mediaTable, {
      fields: [serviceMethodologiesTable.iconId],
      references: [mediaTable.id],
    }),
  }),
);

export const solutionCapabilitiesRelations = relations(
  solutionCapabilitiesTable,
  ({ one }) => ({
    solution: one(solutionsTable, {
      fields: [solutionCapabilitiesTable.solutionId],
      references: [solutionsTable.id],
    }),
    icon: one(mediaTable, {
      fields: [solutionCapabilitiesTable.iconId],
      references: [mediaTable.id],
    }),
  }),
);

export type Service = typeof servicesTable.$inferSelect;
export type InsertService = typeof servicesTable.$inferInsert;
export type Solution = typeof solutionsTable.$inferSelect;
export type InsertSolution = typeof solutionsTable.$inferInsert;
export type ServiceMethodology = typeof serviceMethodologiesTable.$inferSelect;
export type InsertServiceMethodology = typeof serviceMethodologiesTable.$inferInsert;
export type SolutionCapability = typeof solutionCapabilitiesTable.$inferSelect;
export type InsertSolutionCapability = typeof solutionCapabilitiesTable.$inferInsert;
