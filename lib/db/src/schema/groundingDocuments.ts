import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Vega-pattern grounding documents.
//
// Standalone admin-authored records that are injected wholesale into the
// system prompt of an AI call (no chunking, no embeddings — the whole
// `content` goes in). The category + priority + active flag combination
// is the Vega pattern verbatim; `scopeTags` replaces Vega's `tenantId`
// because this site is single-tenant — it lets editors restrict a doc
// to specific audience classes / sectors / applications instead.
//
// `conciergeEligible` lets a doc be included on the public Q&A surface
// (Ask Synozur) without flowing into the future Astra concierge prompt.
// Default `true` keeps the shared-store invariant for normal cases.

export const GROUNDING_CATEGORIES = [
  // Instructional — injected as rules / guidance.
  "methodology",
  "best_practices",
  "terminology",
  "examples",
  // Contextual — injected as organisational background.
  "about_synozur",
  "brand_voice",
  "audience_personas",
  // Reserved for the Astra concierge feature.
  "concierge_persona",
] as const;
export type GroundingCategory = (typeof GROUNDING_CATEGORIES)[number];

export const groundingDocumentsTable = pgTable(
  "grounding_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").$type<GroundingCategory>().notNull(),
    content: text("content").notNull(),
    // Optional scope tags. Null/empty = always inject. When present, the
    // prompt-builder filters by audience class / sector / application tag.
    scopeTags: jsonb("scope_tags").$type<string[]>(),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    conciergeEligible: boolean("concierge_eligible").notNull().default(true),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("grounding_documents_active_priority_idx").on(t.isActive, t.priority),
    index("grounding_documents_category_idx").on(t.category),
  ],
);

export type GroundingDocument = typeof groundingDocumentsTable.$inferSelect;
export type InsertGroundingDocument =
  typeof groundingDocumentsTable.$inferInsert;
