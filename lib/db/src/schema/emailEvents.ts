import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { emailMessagesTable } from "./emailMessages";

// #221 — Per-event row for SendGrid webhook deliveries.
//
// One row per webhook event payload entry. `emailMessageId` is filled in at
// ingest time when the `sg_message_id` prefix matches a row in
// `email_messages`; events that arrive before the corresponding outbound
// row was written (or for messages we didn't originate) are stored with a
// NULL FK so we still capture the full event stream.
export const emailEventsTable = pgTable(
  "email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailMessageId: uuid("email_message_id").references(
      () => emailMessagesTable.id,
      { onDelete: "set null" },
    ),
    // Full sg_message_id from the event (includes the per-recipient suffix).
    sgMessageId: text("sg_message_id").notNull(),
    // SendGrid event name: processed, delivered, bounce, dropped, deferred,
    // spamreport, open, click, unsubscribe, group_unsubscribe, group_resubscribe.
    event: text("event").notNull(),
    emailAddr: text("email_addr"),
    // Free-form reason / response text from SendGrid (bounce reason etc.).
    reason: text("reason"),
    // Full event payload, kept verbatim for debugging.
    payload: jsonb("payload").notNull(),
    // Event timestamp reported by SendGrid (seconds since epoch in payload).
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("email_events_message_idx").on(t.emailMessageId),
    index("email_events_sg_message_idx").on(t.sgMessageId),
    index("email_events_event_at_idx").on(t.eventAt),
  ],
);

export type EmailEvent = typeof emailEventsTable.$inferSelect;
export type InsertEmailEvent = typeof emailEventsTable.$inferInsert;
