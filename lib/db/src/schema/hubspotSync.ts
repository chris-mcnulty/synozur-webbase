import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// #131: durable queue of HubSpot sync attempts. The api-server enqueues a row
// fire-and-forget after a form submission succeeds, then a tick-based worker
// drains the queue with exponential backoff. Persisting outside the call path
// means a HubSpot outage doesn't block visitor responses and lets admins
// replay individual failures.
//
// `kind` covers both contact upserts and timeline events:
//   - "contact.upsert"            → create-or-update Contact by email
//   - "timeline.<event_template>" → emit a custom timeline event
//
// `status` walks `pending → in_flight → succeeded | failed | dead_letter`.
// A row hits `dead_letter` once `attempts >= MAX_ATTEMPTS`; the admin replay
// endpoint resets it to `pending`.
export const hubspotSyncEventsTable = pgTable(
  "hubspot_sync_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    contactEmail: text("contact_email"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    hubspotResourceId: text("hubspot_resource_id"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
  },
  (t) => [
    index("hubspot_sync_status_idx").on(t.status, t.nextAttemptAt),
    index("hubspot_sync_email_idx").on(t.contactEmail),
  ],
);

export type HubspotSyncEvent = typeof hubspotSyncEventsTable.$inferSelect;
export type InsertHubspotSyncEvent = typeof hubspotSyncEventsTable.$inferInsert;
