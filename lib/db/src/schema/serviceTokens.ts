import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Generic server-side OAuth service-account token store. Each row holds a
// persisted refresh token for one external integration (keyed by `key`).
//
// Current consumers:
//   key = "bookings_graph"  — Microsoft Graph delegated token for the Bookings
//                             service account. Populated via the admin OAuth
//                             consent flow at /api/admin/bookings/graph-authorize.
//
// The refresh token is stored in plaintext (it is an opaque bearer credential,
// not a password); access is gated by admin-only routes and DB access controls.
// A new refresh token returned during a token-refresh cycle overwrites the
// existing row (some IdPs rotate refresh tokens).
export const serviceTokensTable = pgTable("service_tokens", {
  key: text("key").primaryKey(),
  refreshToken: text("refresh_token").notNull(),
  accountHint: text("account_hint"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceToken = typeof serviceTokensTable.$inferSelect;
