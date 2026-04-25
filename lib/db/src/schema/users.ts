import { pgTable, uuid, text, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { userRoles } from "./roles";

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Native auth identity. `externalSubject` is the canonical identifier from
    // the upstream IdP — for Entra it's the user's directory object id, which
    // is stable across email changes. `authProvider` discriminates the IdP so
    // we can support Entra alongside an admin-bootstrap provider in dev
    // without colliding ids.
    externalSubject: text("external_subject"),
    authProvider: text("auth_provider"),
    email: text("email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    // #126: Microsoft Entra SSO. tenant id + object id from the Entra ID token
    // are mirrored here. `entraObjectId` is the same value the IdP delivers
    // as the OIDC `sub` claim (and as `oid` in the Microsoft-specific claim
    // set); we store it explicitly to keep group reconciliation queries fast
    // and to survive future swaps of the auth provider without a re-link.
    entraTenantId: text("entra_tenant_id"),
    entraObjectId: text("entra_object_id"),
    lastSsoProvider: text("last_sso_provider"),
    // `entraGroupClaims` is a snapshot of the group object-ids resolved at the
    // last successful sign-in. We persist it so the admin UI can show why a
    // role was granted, and so a deliberate refresh isn't required to inspect
    // group state (we still re-resolve on every sign-in).
    entraGroupClaims: jsonb("entra_group_claims").$type<string[]>(),
    entraGroupsRefreshedAt: timestamp("entra_groups_refreshed_at", { withTimezone: true }),
    // #131: marketing-consent state mirrored on the user row so a registered
    // user's opt-in/out propagates to HubSpot lifecycle changes regardless of
    // which surface flipped it.
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    marketingOptInUpdatedAt: timestamp("marketing_opt_in_updated_at", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_external_subject_key").on(t.authProvider, t.externalSubject),
    index("users_entra_object_id_idx").on(t.entraObjectId),
    index("users_email_idx").on(t.email),
  ],
);

// Server-side session store. The session id (a high-entropy random string) is
// the only thing carried in the cookie; everything else lives here so we can
// invalidate any session unilaterally (sign-out, password rotation, admin
// kick) and so the cookie itself never carries authority.
export const sessionsTable = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;

// Single-use OAuth/OIDC state record — captures `state`, PKCE `code_verifier`,
// the post-auth `returnTo` URL, and a `nonce` to bind to the ID token. The row
// is consumed (deleted) on callback so replays are impossible.
export const authPendingStatesTable = pgTable(
  "auth_pending_states",
  {
    state: text("state").primaryKey(),
    codeVerifier: text("code_verifier").notNull(),
    nonce: text("nonce").notNull(),
    returnTo: text("return_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("auth_pending_states_expires_at_idx").on(t.expiresAt)],
);

export type AuthPendingState = typeof authPendingStatesTable.$inferSelect;
export type InsertAuthPendingState = typeof authPendingStatesTable.$inferInsert;

export const usersRelations = relations(usersTable, ({ many }) => ({
  userRoles: many(userRoles),
}));

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
