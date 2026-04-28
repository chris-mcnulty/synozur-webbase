import { pgTable, uuid, text, timestamp, integer, check, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { assetCategoriesTable } from "./assetCategories";

export const mediaTable = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull(),
    publicUrl: text("public_url").notNull(),
    mime: text("mime"),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size"),
    // #142 Phase A — Required at the DB so an editor never lands on a
    // production page rendering an `<img alt="">`. The placeholder pattern
    // `Image: <name>` is reserved for the backfill script (see
    // `backfillMediaAltText.ts`); the authoring UI surfaces a "needs review"
    // badge for rows still on the placeholder. The CHECK rejects empty /
    // whitespace-only strings since `NOT NULL` alone wouldn't catch them.
    altText: text("alt_text").notNull(),
    originalName: text("original_name"),
    categoryId: uuid("category_id").references(() => assetCategoriesTable.id, {
      onDelete: "set null",
    }),
    uploadedBy: uuid("uploaded_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    // #127 Phase 3 — additive SPE overlay. `storage_key` always points
    // to the original GCS object and is NEVER rewritten or deleted by
    // the migration; that's our rollback safety net. After a row is
    // migrated, `spe_file_id` is the SharePoint drive item id and
    // `spe_container_id` is the container that holds it. Read-path
    // resolution is "spe_file_id first, fall back to storage_key" so
    // unsetting spe_file_id reverts the row to GCS instantly without
    // touching SPE or GCS bytes. The bucket can only be decommissioned
    // after the GCS overlap soak (≥30 days post-cutover) per BACKLOG.
    speFileId: text("spe_file_id"),
    speContainerId: text("spe_container_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "media_alt_text_non_empty",
      sql`length(trim(${t.altText})) > 0`,
    ),
    // #127 Phase 3 — `routes/storage.ts` looks up media rows by
    // storage_key on every /storage/objects/<...> request to resolve
    // the GCS-vs-SPE overlay. Unique because storage_key is 1:1 with
    // a media row (the column is populated by the upload flow with a
    // freshly-minted /objects/<uuid> path) and the uniqueness is what
    // makes the lookup a single-row point read.
    uniqueIndex("media_storage_key_key").on(t.storageKey),
  ],
);

export type Media = typeof mediaTable.$inferSelect;
export type InsertMedia = typeof mediaTable.$inferInsert;

