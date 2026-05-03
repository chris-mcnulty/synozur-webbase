import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

// `ai_chat_sessions` — server-issued anonymous chat sessions for /ai/chat.
// A row is minted by `POST /ai/sessions/start` after a Turnstile check; the
// signed cookie carries the opaque token whose SHA-256 is stored in
// `tokenHash` so a DB leak doesn't yield usable session tokens (same pattern
// as the user `sessions` table).
export const aiChatSessions = pgTable(
  "ai_chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    ipAtCreation: text("ip_at_creation"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("ai_chat_sessions_expires_idx").on(t.expiresAt)],
);

export type AiChatSession = typeof aiChatSessions.$inferSelect;
