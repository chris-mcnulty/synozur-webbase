import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { servicesTable, solutionsTable } from "./services";
import { bookingsTable } from "./bookings";

export type WorkshopCTA = { label: string; href: string };
export type WorkshopPain = { header: string; lead: string; tiles: string[] };
export type WorkshopScope = {
  header: string;
  summary: string;
  bullets: string[];
  included: string[];
};
export type WorkshopProcess = { header: string; steps: string[] };
export type WorkshopDeliverables = {
  header: string;
  core: string[];
  executive: string[];
  enablement: string[];
  addOns: string[];
};
export type WorkshopPrice = {
  label: string;
  startingAt?: number | null;
  display: string;
  timeline: string;
  whatIsIncluded: string[];
};
export type WorkshopDiagnostic = {
  header: string;
  summary: string;
  whatWeAssess: string[];
  questionnairePreview: string[];
  sampleOutputLink?: string | null;
};
export type WorkshopCompetitiveIntel = {
  header: string;
  summary: string;
  outputs: string[];
};
export type WorkshopOutcomes = { header: string; bullets: string[] };
export type WorkshopSampleDeliverables = {
  header: string;
  link?: string | null;
  thumbs: string[];
};
export type WorkshopFAQItem = { q: string; a: string };
export type WorkshopFAQ = { header: string; items: WorkshopFAQItem[] };
export type WorkshopSEO = { title: string; description: string };

export const workshopsTable = pgTable(
  "workshops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull().default(""),
    shortDescription: text("short_description").notNull().default(""),
    heroHeadline: text("hero_headline").notNull().default(""),
    heroSubhead: text("hero_subhead").notNull().default(""),
    heroImage: text("hero_image").notNull().default(""),
    heroTrustBullets: jsonb("hero_trust_bullets").$type<string[]>().notNull().default([]),
    primaryCTA: jsonb("primary_cta").$type<WorkshopCTA>().notNull().default({ label: "", href: "" }),
    secondaryCTA: jsonb("secondary_cta").$type<WorkshopCTA | null>(),
    deliveryFormat: text("delivery_format").notNull().default(""),
    duration: text("duration").notNull().default(""),
    whoItsFor: jsonb("who_its_for").$type<string[]>().notNull().default([]),
    idealParticipants: jsonb("ideal_participants").$type<string[]>().notNull().default([]),
    prerequisites: jsonb("prerequisites").$type<string[]>().notNull().default([]),
    pain: jsonb("pain")
      .$type<WorkshopPain>()
      .notNull()
      .default({ header: "", lead: "", tiles: [] }),
    scope: jsonb("scope")
      .$type<WorkshopScope>()
      .notNull()
      .default({ header: "", summary: "", bullets: [], included: [] }),
    process: jsonb("process")
      .$type<WorkshopProcess>()
      .notNull()
      .default({ header: "", steps: [] }),
    deliverables: jsonb("deliverables")
      .$type<WorkshopDeliverables>()
      .notNull()
      .default({ header: "", core: [], executive: [], enablement: [], addOns: [] }),
    price: jsonb("price")
      .$type<WorkshopPrice>()
      .notNull()
      .default({ label: "", display: "", timeline: "", whatIsIncluded: [] }),
    diagnostic: jsonb("diagnostic").$type<WorkshopDiagnostic | null>(),
    competitiveIntel: jsonb("competitive_intel").$type<WorkshopCompetitiveIntel | null>(),
    toolingNote: text("tooling_note"),
    outcomes: jsonb("outcomes")
      .$type<WorkshopOutcomes>()
      .notNull()
      .default({ header: "", bullets: [] }),
    beforeExample: text("before_example").notNull().default(""),
    afterExample: text("after_example").notNull().default(""),
    sampleDeliverables: jsonb("sample_deliverables")
      .$type<WorkshopSampleDeliverables>()
      .notNull()
      .default({ header: "", thumbs: [] }),
    faq: jsonb("faq").$type<WorkshopFAQ>().notNull().default({ header: "", items: [] }),
    seo: jsonb("seo").$type<WorkshopSEO>().notNull().default({ title: "", description: "" }),
    displayOrder: integer("display_order"),
    sourceId: text("source_id"),
    // #100 / #105: nullable FKs so the "related workshops" rail on the
    // services/solutions pages can be a real DB query instead of a
    // hand-maintained string-match map. A workshop can still have a
    // null service — it just won't show up on a service detail page
    // until assigned.
    serviceId: uuid("service_id").references(() => servicesTable.id, {
      onDelete: "set null",
    }),
    solutionId: uuid("solution_id").references(() => solutionsTable.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id").references(() => bookingsTable.id, {
      onDelete: "set null",
    }),
    active: boolean("active").notNull().default(true),
    featured: boolean("featured").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workshops_slug_key").on(t.slug),
    uniqueIndex("workshops_source_id_key").on(t.sourceId),
    index("workshops_display_order_idx").on(t.displayOrder),
    index("workshops_service_idx").on(t.serviceId),
    index("workshops_solution_idx").on(t.solutionId),
  ],
);

export type Workshop = typeof workshopsTable.$inferSelect;
export type InsertWorkshop = typeof workshopsTable.$inferInsert;
