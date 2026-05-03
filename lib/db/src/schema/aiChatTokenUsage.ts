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

// #167 (paired with #166) — daily rollup of /ai/chat token usage so the
// Site Health dashboard can chart prompt-cache hit rate, dollar savings,
// and pages on-call when the daily hit rate drops below 50 %.
//
// Schema: one row per (utc_day, model). Each /ai/chat request upserts the
// row, summing the four token counters and bumping `requestCount`. The
// route also keeps a denormalized counter of how many requests in the
// window were "cache-warm" (cache_read_input_tokens > 0) so the Site
// Health view can compute hit rate without rescanning raw events.
//
// We deliberately roll up at write time rather than logging a row per
// request — chat traffic for a launch-stage marketing site is well under
// any sane row-count budget here, and the daily rollup keeps the Site
// Health query a single sequential scan over a tiny table.
export const aiChatTokenUsageTable = pgTable(
  "ai_chat_token_usage",
  {
    id: text("id").primaryKey(),
    // The UTC calendar day this rollup row covers, e.g. 2026-05-03.
    utcDay: date("utc_day").notNull(),
    // The Anthropic model id (e.g. "claude-sonnet-4-6"). Different models
    // have different cache-write surcharge / cache-read discount ratios,
    // so the dashboard must keep them apart for accurate dollar-savings.
    model: text("model").notNull(),
    // Counters — `bigint` so a chatty day can't overflow.
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
    // Number of requests in the day where cache_read_input_tokens > 0.
    // Used by the Site Health view to compute the per-request hit rate
    // without re-scanning raw events.
    warmRequestCount: integer("warm_request_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_chat_token_usage_day_model_idx").on(t.utcDay, t.model),
    index("ai_chat_token_usage_last_seen_idx").on(t.lastSeenAt),
  ],
);

export type AiChatTokenUsage = typeof aiChatTokenUsageTable.$inferSelect;
export type InsertAiChatTokenUsage = typeof aiChatTokenUsageTable.$inferInsert;
