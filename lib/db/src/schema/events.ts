import { pgTable, text, serial, timestamp, integer, boolean, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetCategoriesTable } from "./assetCategories";

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedBy: text("uploaded_by"),
  category: text("category"),
  categoryId: uuid("category_id").references(() => assetCategoriesTable.id, {
    onDelete: "set null",
  }),
  altText: text("alt_text"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  uploadedAt: true,
});
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  location: text("location"),
  teaser: text("teaser"),
  description: text("description"),
  registrationUrl: text("registration_url"),
  registrationStatus: text("registration_status").notNull().default("UNKNOWN_REGISTRATION_STATUS"),
  eventType: text("event_type").notNull().default("RSVP"),
  status: text("status").notNull().default("UPCOMING"),
  featured: boolean("featured").notNull().default(false),
  featuredRank: integer("featured_rank"),
  imageAssetId: integer("image_asset_id"),
  recordingVideoId: uuid("recording_video_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof eventsTable.$inferSelect;
