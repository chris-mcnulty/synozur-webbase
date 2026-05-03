import {
  pgTable,
  text,
  timestamp,
  bigint,
  integer,
  uniqueIndex,
  index,
  date,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// #167 (Ask Synozur) — daily prompt-cache rollup, table `ai_chat_prompt_cache_usage`.
//
// One row per (utc_day, model). Each /ai/chat request upserts the row,
// summing the four token counters and bumping `requestCount`. The route
// also tracks how many requests in the window were "cache-warm"
// (cache_read_input_tokens > 0) so the Site Health view can compute hit
// rate without rescanning raw events.
//
// Renamed from `ai_chat_token_usage` during the #166 rebase to make room
// for the budget-enforcement table (below) which carries the same English
// concept of "token usage" but a different shape — per-(day, scopeType,
// scopeId) rather than per-(day, model). Export name unchanged so existing
// dashboard / test consumers keep compiling.
// ---------------------------------------------------------------------------
export const aiChatTokenUsageTable = pgTable(
  "ai_chat_prompt_cache_usage",
  {
    id: text("id").primaryKey(),
    utcDay: date("utc_day").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheCreationInputTokens: bigint("cache_creation_input_tokens", {
      mode: "number",
    })
      .notNull()
      .default(0),
    cacheReadInputTokens: bigint("cache_read_input_tokens", { mode: "number" })
      .notNull()
      .default(0),
    requestCount: integer("request_count").notNull().default(0),
    warmRequestCount: integer("warm_request_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_chat_prompt_cache_usage_day_model_idx").on(t.utcDay, t.model),
    index("ai_chat_prompt_cache_usage_last_seen_idx").on(t.lastSeenAt),
  ],
);

export type AiChatPromptCacheUsage = typeof aiChatTokenUsageTable.$inferSelect;
export type InsertAiChatPromptCacheUsage = typeof aiChatTokenUsageTable.$inferInsert;

// ---------------------------------------------------------------------------
// #166 — daily-rollup token accounting for /ai/chat budget enforcement.
//
// Table `ai_chat_token_usage`. One row per (date, scopeType, scopeId).
// `scopeType` is one of:
//   - "session" — scopeId is an `ai_chat_sessions.id` UUID (or a user id
//                 prefixed with "u:" for authenticated callers).
//   - "ip"      — scopeId is the normalized client IP (ipKeyGenerator).
//   - "global"  — scopeId is the literal string "global".
//
// Caps come from site_settings (`aiChatDailyTokenCapPerSession`,
// `aiChatDailyTokenCapGlobal`); the per-IP cap reuses the per-session value.
// ---------------------------------------------------------------------------
export const aiChatTokenUsage = pgTable(
  "ai_chat_token_usage",
  {
    day: date("day").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    callCount: integer("call_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_chat_token_usage_pk").on(t.day, t.scopeType, t.scopeId),
    index("ai_chat_token_usage_day_idx").on(t.day),
  ],
);

export type AiChatTokenUsage = typeof aiChatTokenUsage.$inferSelect;
