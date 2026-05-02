import { pgTable, uuid, text, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { userRoles } from "./roles";
import { clientOrganizationsTable } from "./clientOrganizations";


export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Native auth identity. `externalSubject` is the OIDC `sub` claim from
    // the upstream IdP — opaque, per-app, and stable across email changes.
    // For Entra, `sub` is *not* the same as the directory object id; the
    // object id (`oid`) is mirrored separately in `entraObjectId` below.
    // `authProvider` discriminates the IdP so we can support Entra alongside
    // an admin-bootstrap provider in dev without colliding ids.
    externalSubject: text("external_subject"),
    authProvider: text("auth_provider"),
    email: text("email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    // Local email/password auth. NULL when the user authenticates via SSO only.
    // This website doubles as a future OAuth provider for other Synozur apps,
    // so we store credentials locally alongside SSO identities.
    passwordHash: text("password_hash"),
    // #126: Microsoft Entra SSO. `entraObjectId` is the directory object id
    // delivered as the Microsoft-specific `oid` claim — distinct from `sub`,
    // and the value Microsoft Graph queries (e.g. /users/{id}/transitiveMemberOf)
    // accept. We store it explicitly so group reconciliation queries don't
    // need to re-derive it from the OIDC subject and so we survive future
    // swaps of the auth provider without a re-link.
    entraTenantId: text("entra_tenant_id"),
    entraObjectId: text("entra_object_id"),
    // `entraGroupClaims` is a snapshot of the group object-ids resolved at the
    // last successful sign-in. We persist it so the admin UI can show why a
    // role was granted, and so a deliberate refresh isn't required to inspect
    // group state (we still re-resolve on every sign-in).
    entraGroupClaims: jsonb("entra_group_claims").$type<string[]>(),
    entraGroupsRefreshedAt: timestamp("entra_groups_refreshed_at", { withTimezone: true }),
    // Client organization this user belongs to. When the org is active, the
    // org's defaultRoleId is automatically granted on every sign-in.
    clientOrganizationId: uuid("client_organization_id").references(
      () => clientOrganizationsTable.id,
      { onDelete: "set null" },
    ),
    // #131: marketing-consent state mirrored on the user row so a registered
    // user's opt-in/out propagates to HubSpot lifecycle changes regardless of
    // which surface flipped it.
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    marketingOptInUpdatedAt: timestamp("marketing_opt_in_updated_at", { withTimezone: true }),
    // Whether the user's email address has been verified via a confirmation link.
    // SSO users (Entra) are considered implicitly verified — the IdP vouches for
    // the address. Only local (email/password) registrants go through the flow.
    emailVerified: boolean("email_verified").notNull().default(false),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_external_subject_key").on(t.authProvider, t.externalSubject),
    index("users_entra_object_id_idx").on(t.entraObjectId),
    index("users_email_idx").on(t.email),
    index("users_client_org_idx").on(t.clientOrganizationId),
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
    rememberMe: boolean("remember_me").notNull().default(false),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type Session = typeof sessionsTable.$inferSelect;
export type InsertSession = typeof sessionsTable.$inferInsert;

// Single-use OAuth/OIDC state record — captures `state`, PKCE `code_verifier`,
// the post-auth `returnTo` URL, a `nonce` to bind to the ID token, and the
// `redirectUri` that was sent in the authorize request (so the callback uses
// the exact same URI — required for PKCE and supports multi-environment
// deployments where the host differs between dev and prod).
// The row is consumed (deleted) on callback so replays are impossible.
export const authPendingStatesTable = pgTable(
  "auth_pending_states",
  {
    state: text("state").primaryKey(),
    codeVerifier: text("code_verifier").notNull(),
    nonce: text("nonce").notNull(),
    returnTo: text("return_to"),
    redirectUri: text("redirect_uri"),
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

// Single-use token for email address verification. Created at registration
// time for local (email/password) accounts; consumed when the user clicks
// the link. Entra SSO users skip this flow entirely.
export const emailVerificationTokensTable = pgTable(
  "email_verification_tokens",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_verification_tokens_user_idx").on(t.userId),
    index("email_verification_tokens_expires_idx").on(t.expiresAt),
  ],
);

export type EmailVerificationToken = typeof emailVerificationTokensTable.$inferSelect;

// Single-use password-reset token. Valid for 1 hour; consumed (usedAt set)
// when the user submits a new password. All pending reset tokens for a user
// are deleted after a successful reset so old links are dead immediately.
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("password_reset_tokens_user_idx").on(t.userId),
    index("password_reset_tokens_expires_idx").on(t.expiresAt),
  ],
);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
