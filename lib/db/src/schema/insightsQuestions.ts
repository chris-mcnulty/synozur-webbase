import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// Ask Synozur question telemetry (#262).
//
// One row per question submitted to /insights/ask. Records the question,
// the retrieved sources (so editors can audit grounding), the final
// answer, and outcome flags so the admin dashboard can compute top
// questions, refusal rate, and low-confidence rate.

export interface AskSource {
  kind: string;
  id: string;
  title: string;
  url: string;
  score?: number;
}

export const insightsQuestionsTable = pgTable(
  "insights_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    question: text("question").notNull(),
    answer: text("answer").notNull().default(""),
    sources: jsonb("sources").$type<AskSource[]>().notNull().default([]),
    model: text("model"),
    refused: boolean("refused").notNull().default(false),
    lowConfidence: boolean("low_confidence").notNull().default(false),
    sourceCount: integer("source_count").notNull().default(0),
    topScore: integer("top_score"),
    clickThroughCount: integer("click_through_count").notNull().default(0),
    sessionId: text("session_id"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("insights_questions_created_at_idx").on(t.createdAt),
    index("insights_questions_refused_idx").on(t.refused),
    index("insights_questions_low_conf_idx").on(t.lowConfidence),
  ],
);

export type InsightQuestion = typeof insightsQuestionsTable.$inferSelect;
export type InsertInsightQuestion = typeof insightsQuestionsTable.$inferInsert;
