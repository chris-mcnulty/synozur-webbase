import { pgTable, text, serial, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// #133 — Anonymous depth=full completions of an in-page application demo.
//
// HubSpot timeline events require a real contact email, but most demo
// visitors are anonymous when they finish the loop. We persist a row keyed
// by an opaque visitor cookie (`syn_visitor`) and let a later identifying
// event (contact form submit with the same cookie) flush these into the
// HubSpot sync queue, attached to the now-known contact email. This way
// the marketing funnel sees the prior demo engagement as soon as the
// visitor identifies themselves, without us synthesizing ghost contacts.
export const applicationDemoCompletionsTable = pgTable(
  "application_demo_completions",
  {
    id: serial("id").primaryKey(),
    app: text("app").notNull(),
    visitorId: text("visitor_id").notNull(),
    step: text("step"),
    path: text("path"),
    payload: jsonb("payload"),
    // Per-session client-generated UUID. Used for end-to-end idempotency:
    // the same UUID is sent with every retry of `demo_completed_full`, so
    // the server's UNIQUE index turns a repeated completion into a no-op.
    // Nullable for legacy rows pre-dating the dedupe column.
    completionId: text("completion_id"),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set when the row has been pushed into hubspot_sync_events because
    // the visitor identified themselves via a contact form. Stays NULL
    // for visitors that never identify (which is the expected majority).
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (t) => [
    index("application_demo_completions_visitor_idx").on(t.visitorId),
    index("application_demo_completions_pending_idx").on(t.syncedAt),
    uniqueIndex("application_demo_completions_completion_id_uidx").on(t.completionId),
  ],
);

export type ApplicationDemoCompletion = typeof applicationDemoCompletionsTable.$inferSelect;
export type InsertApplicationDemoCompletion = typeof applicationDemoCompletionsTable.$inferInsert;
