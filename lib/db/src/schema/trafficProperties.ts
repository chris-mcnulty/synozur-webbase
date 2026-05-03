import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Traffic properties — the registry of distinct Synozur web properties
 * (e.g. "synozur.com", "polaris.synozur.com") whose traffic is reported
 * through this admin. The `slug` is the value that appears in
 * traffic_sessions.source_system / traffic_pageviews.source_system.
 *
 * Two seeded properties:
 *   - `synozur` (is_default = true) — this app's first-party tracker.
 *   - `wix-legacy` — historical Wix exports backfilled into the new tables.
 */
export const trafficPropertiesTable = pgTable(
  "traffic_properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url"),
    // bcrypt hash of the API key. The plaintext is shown to the admin
    // exactly once at create / rotate time and never re-fetched. Nullable
    // for the built-in `synozur` property which uses native collection,
    // not the external ingest endpoint.
    apiKeyHash: text("api_key_hash"),
    apiKeyPrefix: text("api_key_prefix"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("traffic_properties_slug_key").on(t.slug)],
);

/**
 * Per-import-run record. Captures source (api / json / csv), file metadata
 * for traceability, and the rows-accepted / skipped / duplicates counters
 * surfaced in the admin import UI.
 */
export const trafficPropertyImportsTable = pgTable(
  "traffic_property_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => trafficPropertiesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'api' | 'json' | 'csv'
    sourceFile: text("source_file"),
    sourceFileSha256: text("source_file_sha256"),
    accepted: integer("accepted").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [
    index("traffic_property_imports_property_idx").on(t.propertyId, t.createdAt),
  ],
);

export type TrafficProperty = typeof trafficPropertiesTable.$inferSelect;
export type InsertTrafficProperty = typeof trafficPropertiesTable.$inferInsert;
export type TrafficPropertyImport =
  typeof trafficPropertyImportsTable.$inferSelect;
export type InsertTrafficPropertyImport =
  typeof trafficPropertyImportsTable.$inferInsert;
