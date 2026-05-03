import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// #128 — OAuth 2.0 / OIDC provider tables.
//
// This site is the canonical identity surface for downstream Synozur web apps
// (Galaxy #135, Partner Portal #141, future internal tools). The five tables
// below cover the provider-side state: client registrations, signing keys for
// RS256 JWTs, single-use authorization codes, opaque-but-hashed refresh
// tokens with a rotation chain, and persisted user→client consent so the
// consent screen is shown once per scope set.
//
// All credential-shaped columns (client secret, auth code, refresh token) are
// stored hashed at rest — the original value only exists in the response that
// returned it. Private signing keys are encrypted-at-rest when `OAUTH_KEK` is
// configured; see `lib/oauthKeys.ts` in the api-server.

// ─── Clients ──────────────────────────────────────────────────────────────────

export const oauthClientsTable = pgTable(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Public identifier sent in the `client_id` parameter. URL-safe.
    clientId: text("client_id").notNull(),
    // bcrypt hash of the client secret. The plaintext is shown to the admin
    // exactly once at creation time and on rotate; never persisted in plain.
    clientSecretHash: text("client_secret_hash").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Allow-list of exact redirect URIs. The authorize endpoint requires the
    // request's `redirect_uri` to match one of these byte-for-byte.
    redirectUris: text("redirect_uris").array().notNull(),
    // Scopes this client may request. Anything outside this set is rejected
    // at /oauth/authorize.
    allowedScopes: text("allowed_scopes").array().notNull(),
    // OAuth 2.1 grants this client may use. Defaults to authorization_code +
    // refresh_token; client_credentials is opt-in per client.
    allowedGrantTypes: text("allowed_grant_types").array().notNull(),
    // When true, every authorization request from this client must include a
    // PKCE code_challenge. Confidential clients MAY opt out, but PKCE is the
    // recommended default and enforced for all public clients.
    pkceRequired: boolean("pkce_required").notNull().default(true),
    // When true, the token endpoint accepts this client without a
    // client_secret (public client / SPA pattern). PKCE must still pass.
    // Confidential clients (server-side apps) leave this false and present
    // a secret on /oauth/token.
    isPublic: boolean("is_public").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("oauth_clients_client_id_key").on(t.clientId)],
);

export type OAuthClient = typeof oauthClientsTable.$inferSelect;
export type InsertOAuthClient = typeof oauthClientsTable.$inferInsert;

// ─── Signing keys ─────────────────────────────────────────────────────────────

// RS256 key pairs used to sign access + ID tokens. We keep multiple rows so
// rotation is non-disruptive: an old key stays in JWKS (and can verify
// previously-issued tokens) until `retired_at` is past the longest token
// lifetime, while new tokens are signed by the row with `is_active = true`.
//
// `private_key_material` holds either:
//   - a base64-encoded `iv:tag:ciphertext` triple from AES-256-GCM (when
//     `encryption_method = 'kek-aes-256-gcm'`), or
//   - the PEM bytes verbatim (when `encryption_method = 'plaintext'` — used
//     in dev when `OAUTH_KEK` is unset).
// The decryption helper picks the right path based on `encryption_method`.
export const oauthSigningKeysTable = pgTable(
  "oauth_signing_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // JWKS `kid`. UUID-derived so rotation history reads naturally.
    kid: text("kid").notNull(),
    algorithm: text("algorithm").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    privateKeyMaterial: text("private_key_material").notNull(),
    encryptionMethod: text("encryption_method").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("oauth_signing_keys_kid_key").on(t.kid),
    index("oauth_signing_keys_active_idx").on(t.isActive),
  ],
);

export type OAuthSigningKey = typeof oauthSigningKeysTable.$inferSelect;
export type InsertOAuthSigningKey = typeof oauthSigningKeysTable.$inferInsert;

// ─── Authorization codes ──────────────────────────────────────────────────────

// Single-use codes issued by /oauth/authorize and consumed by /oauth/token.
// We store the SHA-256 hash so a DB leak doesn't yield usable codes; the raw
// code only exists in the redirect query string until it's exchanged.
export const oauthAuthorizationCodesTable = pgTable(
  "oauth_authorization_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").array().notNull(),
    // PKCE: the verifier sent at /token must hash to this challenge.
    // Method is 'S256' (recommended) or 'plain' (legacy compat — refused
    // for public clients).
    codeChallenge: text("code_challenge"),
    codeChallengeMethod: text("code_challenge_method"),
    nonce: text("nonce"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("oauth_auth_codes_user_idx").on(t.userId),
    index("oauth_auth_codes_expires_idx").on(t.expiresAt),
  ],
);

export type OAuthAuthorizationCode =
  typeof oauthAuthorizationCodesTable.$inferSelect;
export type InsertOAuthAuthorizationCode =
  typeof oauthAuthorizationCodesTable.$inferInsert;

// ─── Refresh tokens ───────────────────────────────────────────────────────────

// Opaque refresh tokens (NOT JWTs) so we can revoke unilaterally. Stored as
// SHA-256 hash. `parent_token_id` chains rotated tokens together so a replay
// of an already-rotated token can be detected and the whole family revoked
// (RFC 6819 §5.2.2.3 / OAuth 2.1 §4.14.2).
export const oauthRefreshTokensTable = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull(),
    // NULL on the first refresh token in a chain; set to the previous row's
    // id every time we rotate. No DB-level FK constraint is declared (a
    // self-referential FK here would complicate cascades and isn't required
    // for the application-level chain traversal). Chain integrity is enforced
    // in the rotation logic in routes/oauth.ts.
    parentTokenId: uuid("parent_token_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("oauth_refresh_tokens_hash_key").on(t.tokenHash),
    index("oauth_refresh_tokens_user_idx").on(t.userId),
    index("oauth_refresh_tokens_client_idx").on(t.clientId),
    index("oauth_refresh_tokens_expires_idx").on(t.expiresAt),
  ],
);

export type OAuthRefreshToken = typeof oauthRefreshTokensTable.$inferSelect;
export type InsertOAuthRefreshToken =
  typeof oauthRefreshTokensTable.$inferInsert;

// ─── Persisted user→client consent ────────────────────────────────────────────

// One row per (user, client). Consent is "sticky" by scope set: the
// authorize endpoint shows the consent screen only when the requested scopes
// are not a subset of `scopes_granted`. Re-granting overwrites the row in
// place; the user can revoke consent (clears `scopes_granted`, sets
// `revoked_at`) which forces a fresh consent screen on next request.
export const oauthConsentsTable = pgTable(
  "oauth_consents",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    scopesGranted: text("scopes_granted").array().notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.clientId] }),
    index("oauth_consents_client_idx").on(t.clientId),
  ],
);

export type OAuthConsent = typeof oauthConsentsTable.$inferSelect;
export type InsertOAuthConsent = typeof oauthConsentsTable.$inferInsert;
