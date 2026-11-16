import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const portalMessageTable = pgTable("portal_message", {
  id: integer("id").primaryKey().default(1),
  message: text("message").notNull().default(""),
  signature: text("signature").notNull().default(""),
  quarterLabel: text("quarter_label").notNull().default(""),
  visible: boolean("visible").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertPortalMessageSchema = createInsertSchema(portalMessageTable).omit({ id: true, updatedAt: true });
export type PortalMessage = typeof portalMessageTable.$inferSelect;
