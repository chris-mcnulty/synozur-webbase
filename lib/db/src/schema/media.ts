import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { assetCategoriesTable } from "./assetCategories";

export const mediaTable = pgTable("media", {
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
  // badge for rows still on the placeholder.
  altText: text("alt_text").notNull(),
  originalName: text("original_name"),
  categoryId: uuid("category_id").references(() => assetCategoriesTable.id, {
    onDelete: "set null",
  }),
  uploadedBy: uuid("uploaded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Media = typeof mediaTable.$inferSelect;
export type InsertMedia = typeof mediaTable.$inferInsert;
