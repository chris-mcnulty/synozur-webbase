import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// #221 — Outbound transactional email log.
//
// Every successful `sendEmail()` call inserts a row keyed by the
// `X-Message-Id` value SendGrid returns in the response headers. Webhook
// events from SendGrid carry an `sg_message_id` of the form
// "<X-Message-Id>.<filter>-<random>" so we link incoming events back to
// this row by matching the prefix before the first dot.
//
// `latestEvent` / `latestEventAt` are denormalized so the admin list view
// at /admin/email can render the freshest delivery status without doing a
// per-row aggregation against `email_events`.
export const emailMessagesTable = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // X-Message-Id from the SendGrid response. Unique per accepted send.
    messageId: text("message_id").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    // Template/template-family slug, e.g. "comment-approved",
    // "email-verification", "subscription-confirmation". Free-form text so
    // new templates can be added without a schema change.
    template: text("template").notNull(),
    // Mirror of the most recent webhook event for this message — purely a
    // read-side optimisation so the admin list doesn't have to aggregate.
    latestEvent: text("latest_event"),
    latestEventAt: timestamp("latest_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("email_messages_message_id_key").on(t.messageId),
    index("email_messages_created_at_idx").on(t.createdAt),
    index("email_messages_template_idx").on(t.template),
  ],
);

export type EmailMessage = typeof emailMessagesTable.$inferSelect;
export type InsertEmailMessage = typeof emailMessagesTable.$inferInsert;
