import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// API keys for machine-to-machine access (e.g. Orbit service integrations).
//
// Keys are long-lived, scoped to a set of capabilities, hashed at rest
// (SHA-256 hex), and fully revocable by admins. The plaintext is shown
// exactly once — at creation time — and never persisted. The prefix (first
// 8 chars of the random portion after "syn_") is stored for display only,
// so admins can identify a physical key without re-exposing it.

export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    // SHA-256 hex of the full plaintext key. Used for fast O(1) lookup on
    // every request; uniqueness ensures each key maps to exactly one row.
    keyHash: text("key_hash").notNull(),
    // First 8 chars of the random hex portion (after "syn_"). Stored
    // plaintext so the admin UI can render "syn_<prefix>…" without
    // exposing the full key.
    prefix: text("prefix").notNull(),
    // Capabilities this key is authorized to exercise. The auth middleware
    // synthesises a virtual authedUser with these as effectiveCapabilities.
    grantedCapabilities: text("granted_capabilities").array().notNull().default([]),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    // Optional expiry. NULL = no expiry. The auth middleware rejects keys
    // where expiresAt < now().
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Usage telemetry — updated on every authenticated request.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    useCount: integer("use_count").notNull().default(0),
    // Set when an admin revokes the key; non-null = permanently rejected.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_key").on(t.keyHash),
    index("api_keys_prefix_idx").on(t.prefix),
  ],
);

export type ApiKey = typeof apiKeysTable.$inferSelect;
export type InsertApiKey = typeof apiKeysTable.$inferInsert;
