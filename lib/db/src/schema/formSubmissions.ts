import { pgTable, text, serial, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

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
  // #131: marketing opt-in captured at submission. Server-side default is
  // governed by site settings so EU geos can flip to opt-out by default
  // without a code change.
  marketingOptIn: boolean("marketing_opt_in"),
  // First-touch attribution. Captured on first landing in the browser and
  // submitted alongside the form payload; stored explicitly so reporting
  // doesn't have to reach into `payload` JSON.
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  landingPage: text("landing_page"),
  referrer: text("referrer"),
  // HubSpot sync state — populated asynchronously by the sync worker.
  hubspotContactId: text("hubspot_contact_id"),
  hubspotSyncStatus: text("hubspot_sync_status"),
  hubspotSyncError: text("hubspot_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FormSubmission = typeof formSubmissionsTable.$inferSelect;
export type InsertFormSubmission = typeof formSubmissionsTable.$inferInsert;
