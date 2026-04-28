import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * One row per legacy-traffic import run. Used for traceability ("which file
 * did these rows come from?") and to mark the cutover batch as final so the
 * importer knows it can stop running.
 *
 * Pageview/session rows reference this via `import_batch_id`.
 */
export const legacyTrafficBatchesTable = pgTable(
  "legacy_traffic_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: text("source_system").notNull(), // 'wix' for now
    sourceFile: text("source_file").notNull(),
    sourceFileSha256: text("source_file_sha256").notNull(),
    rangeFrom: timestamp("range_from", { withTimezone: true }),
    rangeTo: timestamp("range_to", { withTimezone: true }),
    rowCount: integer("row_count").notNull().default(0),
    sessionsInserted: integer("sessions_inserted").notNull().default(0),
    pageviewsInserted: integer("pageviews_inserted").notNull().default(0),
    unmappedCount: integer("unmapped_count").notNull().default(0),
    isFinal: boolean("is_final").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("legacy_traffic_batches_file_sha_key").on(
      t.sourceSystem,
      t.sourceFileSha256,
    ),
    index("legacy_traffic_batches_created_at_idx").on(t.createdAt),
  ],
);

/**
 * Triage table for legacy paths that the importer could not resolve through
 * `wix_redirects` to a current path on the new platform. Rows are kept so an
 * editor can review and either add a redirect or accept that the page no
 * longer exists.
 */
export const legacyTrafficUnmappedTable = pgTable(
  "legacy_traffic_unmapped",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: text("source_system").notNull(),
    sourcePath: text("source_path").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    occurrences: integer("occurrences").notNull().default(1),
    pageviews: integer("pageviews").notNull().default(0),
    samplePageType: text("sample_page_type"),
    notes: text("notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedToPath: text("resolved_to_path"),
    sample: jsonb("sample"),
  },
  (t) => [
    uniqueIndex("legacy_traffic_unmapped_source_key").on(
      t.sourceSystem,
      t.sourcePath,
    ),
    index("legacy_traffic_unmapped_last_seen_idx").on(t.lastSeenAt),
    index("legacy_traffic_unmapped_resolved_idx").on(t.resolvedAt),
  ],
);

export type LegacyTrafficBatch = typeof legacyTrafficBatchesTable.$inferSelect;
export type InsertLegacyTrafficBatch =
  typeof legacyTrafficBatchesTable.$inferInsert;
export type LegacyTrafficUnmapped =
  typeof legacyTrafficUnmappedTable.$inferSelect;
export type InsertLegacyTrafficUnmapped =
  typeof legacyTrafficUnmappedTable.$inferInsert;
