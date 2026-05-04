import {
  pgTable,
  text,
  jsonb,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { servicesTable, solutionsTable } from "./services";
import {
  artifactIdentity,
  artifactLifecycle,
  artifactSeo,
  artifactTimestamps,
} from "./_artifactBase";
import { tsvector } from "./_searchTsv";

// Case studies (#102). Moves the 633-line static TS file at
// `artifacts/synozur/src/data/case-studies.ts` into a DB table built on the
// shared #98 artifact-type pattern so editors can publish new studies
// without a developer commit. Rich narrative lives in three HTML
// sections (challenge / approach / outcome) plus a metrics table and a
// pull-quote — matches the existing public detail page layout.

export type CaseStudyMetric = { label: string; value: string };
export type CaseStudySection = {
  heading: string;
  body: string[];
  bullets?: string[];
};

export const caseStudiesTable = pgTable(
  "case_studies",
  {
    ...artifactIdentity,
    client: text("client").notNull().default(""),
    clientLabel: text("client_label").notNull().default(""),
    industry: text("industry").notNull().default(""),
    established: text("established"),
    tag: text("tag").notNull().default(""),
    headline: text("headline").notNull().default(""),
    summary: text("summary").notNull().default(""),
    heroImage: text("hero_image").notNull().default(""),
    clientLogo: text("client_logo"),
    challenge: jsonb("challenge")
      .$type<CaseStudySection>()
      .notNull()
      .default({ heading: "The challenge", body: [] }),
    approach: jsonb("approach")
      .$type<CaseStudySection[]>()
      .notNull()
      .default([]),
    outcome: jsonb("outcome")
      .$type<CaseStudySection>()
      .notNull()
      .default({ heading: "The outcome", body: [] }),
    metrics: jsonb("metrics")
      .$type<CaseStudyMetric[]>()
      .notNull()
      .default([]),
    quoteText: text("quote_text").notNull().default(""),
    quoteAttribution: text("quote_attribution").notNull().default(""),
    atAGlance: text("at_a_glance"),
    whatWeDid: text("what_we_did"),
    whyItWorked: text("why_it_worked"),
    // #100: FK to primary service / solution for filtered rails.
    serviceId: uuid("service_id").references(() => servicesTable.id, {
      onDelete: "set null",
    }),
    solutionId: uuid("solution_id").references(() => solutionsTable.id, {
      onDelete: "set null",
    }),
    ...artifactLifecycle,
    ...artifactSeo,
    ...artifactTimestamps,
    // #170: full-text search vector — see posts.ts comment.
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(headline, '') || ' ' || coalesce(summary, '')), 'B') || setweight(to_tsvector('english', translate(coalesce(challenge::text, '') || ' ' || coalesce(approach::text, '') || ' ' || coalesce(outcome::text, '') || ' ' || coalesce(quote_text, ''), '<>"[]{},', '        ')), 'C')`,
    ),
  },
  (t) => [
    uniqueIndex("case_studies_slug_key").on(t.slug),
    uniqueIndex("case_studies_source_id_key").on(t.sourceId),
    index("case_studies_industry_idx").on(t.industry),
    index("case_studies_tag_idx").on(t.tag),
    index("case_studies_service_idx").on(t.serviceId),
    index("case_studies_solution_idx").on(t.solutionId),
    index("case_studies_published_at_idx").on(t.publishedAt),
    index("case_studies_featured_rank_idx").on(t.featured, t.featuredRank),
  ],
);

export const caseStudiesRelations = relations(caseStudiesTable, ({ one }) => ({
  service: one(servicesTable, {
    fields: [caseStudiesTable.serviceId],
    references: [servicesTable.id],
  }),
  solution: one(solutionsTable, {
    fields: [caseStudiesTable.solutionId],
    references: [solutionsTable.id],
  }),
}));

export type CaseStudy = typeof caseStudiesTable.$inferSelect;
export type InsertCaseStudy = typeof caseStudiesTable.$inferInsert;
