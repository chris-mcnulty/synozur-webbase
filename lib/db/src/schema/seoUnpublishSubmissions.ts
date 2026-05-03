import { pgTable, serial, text, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";

// #254 — Tracks per-channel SEO unpublish-submission attempts triggered when
// a public artifact transitions to a "gone" state (status='archived', past
// unpublishedAt, or active=false). One row per (channel, attempt). The
// admin Launch Readiness page reads the most-recent row per channel so an
// operator can confirm IndexNow / Google Indexing API / Bing Webmaster Tools
// were actually pinged after an unpublish.
export const seoUnpublishSubmissionsTable = pgTable(
  "seo_unpublish_submissions",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    slug: text("slug").notNull(),
    url: text("url").notNull(),
    channel: text("channel").notNull(),
    ok: boolean("ok").notNull(),
    httpStatus: integer("http_status"),
    submitted: integer("submitted").notNull().default(0),
    error: text("error"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelSubmittedAtIdx: index("seo_unpublish_submissions_channel_submitted_at_idx").on(
      t.channel,
      t.submittedAt,
    ),
  }),
);

export type SeoUnpublishSubmission = typeof seoUnpublishSubmissionsTable.$inferSelect;
