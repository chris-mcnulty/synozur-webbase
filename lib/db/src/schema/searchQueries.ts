import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// #170 — Search telemetry. Every public `/api/search` request inserts one
// row capturing the query and the result count; if the visitor clicks a
// result, the same row is updated with the kind and rank that was clicked
// so the admin "top zero-result queries" and click-through reports can
// surface content gaps. The body of the query is stored verbatim plus a
// lower-cased / whitespace-collapsed `queryNormalized` column so the
// aggregate report can group "Power Platform" and "power  platform"
// together without re-doing that work in SQL on every load.
export const searchQueriesTable = pgTable(
  "search_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    query: text("query").notNull(),
    queryNormalized: text("query_normalized").notNull(),
    resultCount: integer("result_count").notNull().default(0),
    clickedKind: text("clicked_kind"),
    clickedRank: integer("clicked_rank"),
    clickedSlug: text("clicked_slug"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("search_queries_normalized_idx").on(t.queryNormalized),
    index("search_queries_created_at_idx").on(t.createdAt),
    index("search_queries_zero_result_idx").on(t.resultCount, t.createdAt),
  ],
);

export type SearchQueryRow = typeof searchQueriesTable.$inferSelect;
export type InsertSearchQueryRow = typeof searchQueriesTable.$inferInsert;
