import { pgTable, uuid, text, integer, timestamp, numeric, boolean, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Monetary values are manual speech-rate snapshots, never invoice charges.
export const chapterAudioRatesTable = pgTable("chapter_audio_rates", {
  id: uuid("id").primaryKey(),
  perMillion: numeric("per_million", { precision: 18, scale: 6 }).notNull(),
  currency: text("currency").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [check("chapter_audio_rates_per_million_check", sql`${table.perMillion} >= 0`)]);

export const chapterAudioMeteringTable = pgTable("chapter_audio_metering", {
  id: integer("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [check("chapter_audio_metering_id_check", sql`${table.id} = 1`)]);

// No manuscript text, SSML, provider response, or job title is stored here.
// Deliberately no cascading job FK: minimal usage audit survives file deletion.
export const chapterAudioUsageTable = pgTable("chapter_audio_usage", {
  id: uuid("id").primaryKey(),
  jobId: uuid("job_id"),
  kind: text("kind").notNull(),
  actorId: text("actor_id").notNull(),
  actorLabel: text("actor_label").notNull(),
  voice: text("voice").notNull(),
  sectionIndex: integer("section_index"),
  characters: integer("characters").notNull(),
  outcome: text("outcome").notNull(),
  isRetry: boolean("is_retry").notNull().default(false),
  rateId: uuid("rate_id"),
  ratePerMillion: numeric("rate_per_million", { precision: 18, scale: 6 }),
  currency: text("currency"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, table => [
  index("chapter_audio_usage_job_idx").on(table.jobId),
  index("chapter_audio_usage_month_idx").on(table.startedAt),
  check("chapter_audio_usage_characters_check", sql`${table.characters} >= 0`),
]);
