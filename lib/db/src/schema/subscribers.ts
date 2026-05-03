import { pgTable, text, serial, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// #259 — Double opt-in (DOI) for newsletter subscribers.
//
// Each row is a unique email address. `status` advances pending → confirmed,
// or pending/confirmed → unsubscribed. The HMAC of the active confirmation
// token is stored (not the token itself) so a database leak does not let an
// attacker confirm arbitrary addresses. `confirmed_ip` and
// `confirmed_user_agent` are recorded at confirm time to satisfy the
// GDPR/CASL evidentiary requirement that we captured an explicit
// affirmative action — not just a server-side submit IP.
export const subscribersTable = pgTable(
  "subscribers",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"),
    source: text("source"),
    confirmationTokenHash: text("confirmation_token_hash"),
    confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedIp: text("confirmed_ip"),
    confirmedUserAgent: text("confirmed_user_agent"),
    submittedIp: text("submitted_ip"),
    submittedUserAgent: text("submitted_user_agent"),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    // #259 — Grandfathered (pre-DOI) subscribers backfilled from
    // form_submissions. Set at backfill time and cleared once the row has
    // been re-confirmed (or rotated to pending by the reconfirmation
    // campaign). The reconfirmation script targets only rows where this is
    // non-null so it cannot accidentally re-mail organically-DOI-confirmed
    // contacts after launch.
    grandfatheredAt: timestamp("grandfathered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    emailUnique: uniqueIndex("subscribers_email_unique").on(t.email),
    statusIdx: index("subscribers_status_idx").on(t.status),
  }),
);

export type Subscriber = typeof subscribersTable.$inferSelect;
export type InsertSubscriber = typeof subscribersTable.$inferInsert;
export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed";
