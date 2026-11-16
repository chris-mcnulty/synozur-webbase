import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, bigint, integer, timestamp, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { privateCustomerPagesTable } from "./privateCustomerPages";
import { usersTable } from "./users";

/** Explicit private registry; never insert these files into the media library. */
export const privateCustomerAssetsTable = pgTable("private_customer_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id").notNull().references(() => privateCustomerPagesTable.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  kind: text("kind").$type<"html" | "audio" | "transcript">().notNull(),
  state: text("state").$type<"uploading" | "ready" | "failed" | "retired">().notNull().default("uploading"),
  containerId: text("container_id"),
  itemId: text("item_id"),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("private_customer_assets_revision_kind_key").on(t.pageId, t.revision, t.kind),
  index("private_customer_assets_storage_idx").on(t.containerId, t.itemId),
  check("private_customer_assets_kind_check", sql`${t.kind} IN ('html', 'audio', 'transcript')`),
  check("private_customer_assets_state_check", sql`${t.state} IN ('uploading', 'ready', 'failed', 'retired')`),
  check("private_customer_assets_revision_check", sql`${t.revision} > 0`),
  check("private_customer_assets_ready_check", sql`
    ${t.state} <> 'ready' OR (
      ${t.containerId} IS NOT NULL AND ${t.itemId} IS NOT NULL
      AND ${t.sizeBytes} IS NOT NULL AND ${t.sizeBytes} > 0
      AND ${t.sha256} IS NOT NULL AND ${t.sha256} ~ '^[a-f0-9]{64}$'
    )
  `),
]);

export const insertPrivateCustomerAssetSchema = createInsertSchema(privateCustomerAssetsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type PrivateCustomerAsset = typeof privateCustomerAssetsTable.$inferSelect;
export type InsertPrivateCustomerAsset = typeof privateCustomerAssetsTable.$inferInsert;
