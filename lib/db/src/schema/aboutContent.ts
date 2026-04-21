import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// #104: small DB-backed tables for the About page values block, the
// client testimonials rail on /clients, and the partner descriptions on
// /partners. Each has a stable `slug` so seeded rows are idempotent,
// plus a display order, active flag, and standard timestamps. Pages
// read at render time and fall back to hardcoded defaults when the
// table is empty, so adoption can be gradual.

export const aboutValuesTable = pgTable(
  "about_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    icon: text("icon"),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("about_values_slug_key").on(t.slug),
    index("about_values_display_order_idx").on(t.displayOrder),
  ],
);

export const clientTestimonialsTable = pgTable(
  "client_testimonials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    quote: text("quote").notNull().default(""),
    authorName: text("author_name").notNull().default(""),
    authorRole: text("author_role"),
    organization: text("organization").notNull().default(""),
    caseStudySlug: text("case_study_slug"),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_testimonials_slug_key").on(t.slug),
    index("client_testimonials_display_order_idx").on(t.displayOrder),
  ],
);

export const partnerDescriptionsTable = pgTable(
  "partner_descriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    logo: text("logo"),
    websiteUrl: text("website_url"),
    // One of "primary" | "alliance" | "implementation" | "technology" —
    // free-form text so editors can introduce new buckets without a
    // schema change. Matches the section structure on /partners.
    category: text("category").notNull().default("alliance"),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_descriptions_slug_key").on(t.slug),
    index("partner_descriptions_category_idx").on(t.category),
    index("partner_descriptions_display_order_idx").on(t.displayOrder),
  ],
);

export type AboutValue = typeof aboutValuesTable.$inferSelect;
export type InsertAboutValue = typeof aboutValuesTable.$inferInsert;
export type ClientTestimonial = typeof clientTestimonialsTable.$inferSelect;
export type InsertClientTestimonial = typeof clientTestimonialsTable.$inferInsert;
export type PartnerDescription = typeof partnerDescriptionsTable.$inferSelect;
export type InsertPartnerDescription = typeof partnerDescriptionsTable.$inferInsert;
