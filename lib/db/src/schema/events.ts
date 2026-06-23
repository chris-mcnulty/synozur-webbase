import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  uuid,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetCategoriesTable } from "./assetCategories";
import { mediaTable } from "./media";
import { teamMembersTable } from "./teamMembers";

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
  endDate: timestamp("end_date", { withTimezone: true }),
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
  // Parallel UUID FK to the unified `media` table. New writes from the
  // editor populate this column; the legacy integer `imageAssetId` stays in
  // place until BACKLOG.md §1 item 2 drops it. Backfilled by
  // `scripts/backfillMediaIds.ts` via the assets→media storage_key map.
  imageMediaId: uuid("image_media_id").references(() => mediaTable.id, {
    onDelete: "set null",
  }),
  recordingVideoId: uuid("recording_video_id"),
  timezone: text("timezone"),
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

// Many-to-many: which team members are speaking at / appearing at an
// event. Editors set the list from the admin event form; the public
// event detail page renders the corresponding bios, and each team
// member's bio page surfaces their upcoming and most recent events.
//
// `sortOrder` is editor-controlled (lower first, ties broken by team
// member's name) so the keynote can appear before panelists. Deletes
// cascade from either side — un-publishing a team member or deleting
// an event tears down the link without leaving orphans.
export const eventSpeakersTable = pgTable(
  "event_speakers",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    teamMemberId: integer("team_member_id")
      .notNull()
      .references(() => teamMembersTable.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.teamMemberId] }),
    index("event_speakers_event_idx").on(t.eventId),
    index("event_speakers_team_member_idx").on(t.teamMemberId),
  ],
);

export type EventSpeaker = typeof eventSpeakersTable.$inferSelect;
export type InsertEventSpeaker = typeof eventSpeakersTable.$inferInsert;

// Per-event session schedule — imported from conference CSV or entered
// manually. Each row is one session slot (talk, workshop, breakout, etc.)
// at the event. Used to power the public shareable schedule page at
// /events/:slug/schedule.
export const eventSessionsTable = pgTable(
  "event_sessions",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sessionType: text("session_type"),
    speakers: text("speakers"),
    track: text("track"),
    room: text("room"),
    startTime: timestamp("start_time", { withTimezone: false }),
    sessionUrl: text("session_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_sessions_event_idx").on(t.eventId),
  ],
);

export type EventSession = typeof eventSessionsTable.$inferSelect;
export type InsertEventSession = typeof eventSessionsTable.$inferInsert;

// Native event registrations — collected via the in-page modal when
// registrationStatus === 'OPEN'. One row per registrant per event.
// `formSubmissionId` is a FK to form_submissions (plain integer, no
// Drizzle reference because the table lives in a different schema file
// and circular imports in barrel re-exports cause build issues).
export const eventRegistrationsTable = pgTable(
  "event_registrations",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    formSubmissionId: integer("form_submission_id").notNull(),
    remindAt: timestamp("remind_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_registrations_event_idx").on(t.eventId),
    index("event_registrations_remind_at_idx").on(t.remindAt),
  ],
);

export type EventRegistration = typeof eventRegistrationsTable.$inferSelect;
export type InsertEventRegistration = typeof eventRegistrationsTable.$inferInsert;

// Generic deferred email queue. `kind` is a stable slug (e.g.
// "event_reminder") that the drain worker dispatches to the correct
// send function. `payload` carries the data the send function needs
// (event title, slug, date, location, recipient first name, etc.).
export const pendingEmailRemindersTable = pgTable(
  "pending_email_reminders",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pending_email_reminders_scheduled_idx").on(t.scheduledFor),
  ],
);

export type PendingEmailReminder = typeof pendingEmailRemindersTable.$inferSelect;
export type InsertPendingEmailReminder = typeof pendingEmailRemindersTable.$inferInsert;
