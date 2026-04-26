import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { collateralTable } from "./collateral";
import { mediaTable } from "./media";

// #122 — companion files attached to a library item. Webinars, workshops,
// and white papers ship with multiple resources (slides, transcript,
// Q&A log, code repo link, follow-up deck). Before this table the only
// attachment was a single `collateral.downloadUrl`, which editors worked
// around by concatenating URLs into the body HTML.
//
// Each row is either media-backed (`mediaId` set, links to the unified
// `media` table) or external (`externalUrl` set, points at GitHub, Figma,
// an external CDN, etc.). The CHECK below enforces exactly-one-of.
//
// `collateral.downloadUrl` is retained for now as a read-only mirror of
// the first-by-sortOrder resource; it will be dropped in a follow-up
// once every consumer has migrated.
export const collateralResourcesTable = pgTable(
  "collateral_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collateralId: uuid("collateral_id")
      .notNull()
      .references(() => collateralTable.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").references(() => mediaTable.id, {
      onDelete: "set null",
    }),
    externalUrl: text("external_url"),
    label: text("label").notNull(),
    mimeType: text("mime_type"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("collateral_resources_collateral_idx").on(t.collateralId, t.sortOrder),
    check(
      "collateral_resources_target_present",
      sql`${t.mediaId} is not null or ${t.externalUrl} is not null`,
    ),
  ],
);

export const collateralResourcesRelations = relations(
  collateralResourcesTable,
  ({ one }) => ({
    collateral: one(collateralTable, {
      fields: [collateralResourcesTable.collateralId],
      references: [collateralTable.id],
    }),
    media: one(mediaTable, {
      fields: [collateralResourcesTable.mediaId],
      references: [mediaTable.id],
    }),
  }),
);

export type CollateralResource = typeof collateralResourcesTable.$inferSelect;
export type InsertCollateralResource = typeof collateralResourcesTable.$inferInsert;
