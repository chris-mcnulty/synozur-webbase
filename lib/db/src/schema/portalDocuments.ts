import {
  pgTable,
  text,
  uuid,
  timestamp,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { engagementsTable } from "./engagements";
import { usersTable } from "./users";

// Portal-visible deliverables — one row per file an account manager has
// indexed (and optionally published) from the engagement's SPE folder.
// Galaxy clients only ever see rows where `publishedAt IS NOT NULL` and
// `deletedAt IS NULL`. Indexed-but-unpublished rows are admin-only drafts.
export const portalDocumentsTable = pgTable(
  "portal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagementsTable.id, { onDelete: "cascade" }),
    // Path inside the SPE container that the indexer walked (e.g.
    // `/engagements/acme-roadmap`). Stored so the daily reconcile can
    // re-list the right folder without re-reading the engagement row.
    spePath: text("spe_path").notNull(),
    // Microsoft Graph driveItem id — the canonical SPE handle the
    // streaming download route uses. Renamed `space_item_id` per the
    // task spec, which keeps the column name stable even if Graph
    // renames its concept later.
    spaceItemId: text("space_item_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default(""),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }),
    // `publishedAt = null` is the v0 visibility gate: clients never see
    // unpublished rows. `publishedBy` is the user id of the AM who
    // toggled it on.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // #242 — timestamp of the most recent customer-facing publish
    // notification email that included this document. Null means a
    // notification is still owed (either because the row was just
    // published, or because it was unpublished/republished and is
    // pending fresh notification). The flusher uses (publishedAt
    // IS NOT NULL AND notifiedAt IS NULL) as the work queue and
    // throttles on a per-engagement basis.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    // Microsoft Graph `webUrl` for the underlying SPE driveItem. Used
    // by the Galaxy preview drawer to surface an "Open in browser"
    // link for Office documents (the only reliable way to render
    // .docx/.xlsx/.pptx in the user's browser).
    webUrl: text("web_url"),
  },
  (t) => [
    // Unique per engagement so re-indexing the same SPE item updates
    // (rather than duplicates) the existing row. SPE item ids are
    // globally unique, but scoping the index to engagement keeps the
    // foreign-key/indexed-path relationship clean and lets the same
    // file appearing in two engagements stay distinguishable.
    uniqueIndex("portal_documents_engagement_item_key").on(
      t.engagementId,
      t.spaceItemId,
    ),
    index("portal_documents_engagement_published_idx").on(
      t.engagementId,
      t.publishedAt,
    ),
  ],
);

export type PortalDocument = typeof portalDocumentsTable.$inferSelect;
export type InsertPortalDocument = typeof portalDocumentsTable.$inferInsert;
