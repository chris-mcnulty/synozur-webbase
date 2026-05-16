import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Editorial corpus chunks (#262, phase 0).
//
// One row per ~500-word chunk of a published Insights post, case study,
// white paper, FAQ item, or Polaris episode. The Ask Synozur feature
// retrieves relevant chunks via Postgres FTS over `text_search` (a
// generated tsvector column added in startup migrations) and feeds the
// top matches to Claude as grounding for a cited answer.
//
// The `embedding vector(1536)` column called for in the task description
// is intentionally deferred — the OpenAI embeddings API is not currently
// supported via the Replit AI Integrations proxy. The schema keeps a
// nullable text column (`embedding_model_version`) so a future pgvector
// rollout (#170 follow-up) can extend this table without a rewrite.

export const EDITORIAL_SOURCE_KINDS = [
  "post",
  "case_study",
  "white_paper",
  "faq",
  "polaris",
  "application",
  "landing_page",
] as const;
export type EditorialSourceKind = (typeof EDITORIAL_SOURCE_KINDS)[number];

export const editorialChunksTable = pgTable(
  "editorial_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKind: text("source_kind").$type<EditorialSourceKind>().notNull(),
    sourceId: uuid("source_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    text: text("text").notNull(),
    embeddingModelVersion: text("embedding_model_version"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("editorial_chunks_source_chunk_key").on(
      t.sourceKind,
      t.sourceId,
      t.chunkIndex,
    ),
    index("editorial_chunks_source_idx").on(t.sourceKind, t.sourceId),
  ],
);

export type EditorialChunk = typeof editorialChunksTable.$inferSelect;
export type InsertEditorialChunk = typeof editorialChunksTable.$inferInsert;
