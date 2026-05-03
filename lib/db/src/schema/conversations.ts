import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users";

// `aiChatSessions` is declared lazily (forward reference) to avoid a
// circular import between this file and `aiChatSessions.ts`. The DB-level
// FK is added via `runMigrations()` so drizzle-kit doesn't need to see it.
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    // Exactly one of `ownerUserId` / `ownerSessionId` is non-null when the
    // row is created (enforced in the route handler). Both can become null
    // later if the upstream session row is purged — orphaned conversations
    // are inaccessible (the ownership check rejects them) and are pruned by
    // a periodic GC.
    ownerUserId: uuid("owner_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    ownerSessionId: uuid("owner_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("conversations_owner_user_idx").on(t.ownerUserId),
    index("conversations_owner_session_idx").on(t.ownerSessionId),
  ],
);

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
