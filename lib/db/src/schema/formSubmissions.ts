import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";

export const formSubmissionsTable = pgTable("form_submissions", {
  id: serial("id").primaryKey(),
  formType: text("form_type").notNull(),
  email: text("email"),
  name: text("name"),
  company: text("company"),
  payload: jsonb("payload").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  webhookStatus: text("webhook_status"),
  webhookError: text("webhook_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FormSubmission = typeof formSubmissionsTable.$inferSelect;
export type InsertFormSubmission = typeof formSubmissionsTable.$inferInsert;
