import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Briefing Podcast feature.
//
// Two tables:
//   • `briefing_podcast_clients` — the approved allow-list of senders
//     permitted to submit a briefing (by emailing the watched mailbox) and
//     receive an audio version back. All senders require an approved row here.
//   • `briefing_podcasts` — one row per generated MP3, recording where the
//     audio lives in SharePoint Embedded (container + drive item id) so the
//     purge endpoint and admin history view can find and delete it.

export const BRIEFING_CLIENT_STATUSES = ["approved", "revoked"] as const;
export type BriefingClientStatus = (typeof BRIEFING_CLIENT_STATUSES)[number];

export const briefingPodcastClientsTable = pgTable(
  "briefing_podcast_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Normalized (lowercased, trimmed) sender address the inbound handler
    // matches against. Unique so re-approving the same address updates in
    // place rather than creating duplicates.
    email: text("email").notNull(),
    // Optional human label shown in the admin list and used in the greeting
    // of the returned email.
    displayName: text("display_name"),
    // Free-form note for the approving admin (which client / engagement).
    organizationLabel: text("organization_label"),
    status: text("status").notNull().default("approved"),
    // When true the MP3 is stored in SPE and streamed via the audio proxy.
    // When false the MP3 is attached directly to the delivery email then
    // deleted from SPE — no streaming URL or purge link is included.
    retainRecording: boolean("retain_recording").notNull().default(true),
    // Optional per-client voice override. When set, this voice is used instead
    // of the global site_settings voice for this client's briefings. Applies to
    // whichever TTS engine is active (Azure or OpenAI). Null = use global default.
    voiceOverride: text("voice_override"),
    // Admin user id (users.id) who approved/last-updated this entry.
    approvedByUserId: uuid("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("briefing_podcast_clients_email_key").on(t.email),
    index("briefing_podcast_clients_status_idx").on(t.status),
  ],
);

export type BriefingPodcastClient =
  typeof briefingPodcastClientsTable.$inferSelect;
export type InsertBriefingPodcastClient =
  typeof briefingPodcastClientsTable.$inferInsert;

export const BRIEFING_PODCAST_STATUSES = [
  "processing",
  "delivered",
  "failed",
  "purged",
] as const;
export type BriefingPodcastStatus =
  (typeof BRIEFING_PODCAST_STATUSES)[number];

export const briefingPodcastsTable = pgTable(
  "briefing_podcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The address the briefing was returned to. For client submissions this
    // is the (approved) sender; for the owner's own briefing it's the owner.
    recipientEmail: text("recipient_email").notNull(),
    // "owner" for the internal daily run, "client" for allow-listed senders.
    source: text("source").notNull().default("client"),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("processing"),
    // SharePoint Embedded location of the MP3. Both are needed for the
    // purge endpoint (deleteFile takes an explicit container override).
    speContainerId: text("spe_container_id"),
    speItemId: text("spe_item_id"),
    durationSeconds: integer("duration_seconds"),
    byteSize: integer("byte_size"),
    error: text("error"),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("briefing_podcasts_recipient_idx").on(t.recipientEmail),
    index("briefing_podcasts_created_at_idx").on(t.createdAt),
    index("briefing_podcasts_status_idx").on(t.status),
  ],
);

export type BriefingPodcast = typeof briefingPodcastsTable.$inferSelect;
export type InsertBriefingPodcast = typeof briefingPodcastsTable.$inferInsert;
