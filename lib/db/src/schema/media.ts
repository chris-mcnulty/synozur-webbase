import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const mediaTable = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull(),
  publicUrl: text("public_url").notNull(),
  mime: text("mime"),
  width: integer("width"),
  height: integer("height"),
  byteSize: integer("byte_size"),
  altText: text("alt_text"),
  uploadedBy: uuid("uploaded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Media = typeof mediaTable.$inferSelect;
export type InsertMedia = typeof mediaTable.$inferInsert;
