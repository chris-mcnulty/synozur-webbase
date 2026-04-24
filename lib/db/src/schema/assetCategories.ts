import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetCategoriesTable = pgTable(
  "asset_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    slugIdx: uniqueIndex("asset_categories_slug_idx").on(t.slug),
  }),
);

export const insertAssetCategorySchema = createInsertSchema(assetCategoriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAssetCategory = z.infer<typeof insertAssetCategorySchema>;
export type AssetCategoryRow = typeof assetCategoriesTable.$inferSelect;
