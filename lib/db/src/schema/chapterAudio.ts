import { pgTable, uuid, text, integer, timestamp, doublePrecision, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";

// Narration bytes and manuscript content live only in private object storage.
export const chapterAudioJobsTable = pgTable("chapter_audio_jobs", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  creatorId: text("creator_id").notNull(),
  creatorName: text("creator_name").notNull(),
  voice: text("voice").notNull(),
  initialEstimate: jsonb("initial_estimate"),
  meteringVersion: integer("metering_version").notNull().default(0),
  status: text("status").notNull().default("queued"),
  wordCount: integer("word_count").notNull(),
  totalChunks: integer("total_chunks").notNull(),
  completedChunks: integer("completed_chunks").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  error: text("error"),
  processingStage: text("processing_stage"),
  diagnostics: jsonb("diagnostics").notNull().default(sql`'[]'::jsonb`),
  durationSeconds: doublePrecision("duration_seconds"),
  audioBytes: integer("audio_bytes"),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  cleanedAt: timestamp("cleaned_at", { withTimezone: true }),
}, table => [index("chapter_audio_jobs_queue_idx").on(table.status, table.expiresAt)]);
export const insertChapterAudioJobSchema = createInsertSchema(chapterAudioJobsTable);
export type ChapterAudioJobRecord = typeof chapterAudioJobsTable.$inferSelect;

// Private SPE references; never included in public media or API responses.
export const chapterAudioFilesTable = pgTable("chapter_audio_files", {
  fileKey: text("file_key").primaryKey(),
  itemId: text("item_id").notNull(),
  containerId: text("container_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
