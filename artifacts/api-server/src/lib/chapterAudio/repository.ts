import { pool } from "@workspace/db";

export type ChapterStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "expired" | "deleting";
export interface ChapterRow {
  id: string; title: string; creator_id: string; creator_name: string; voice: string;
  status: ChapterStatus; word_count: number; total_chunks: number; completed_chunks: number;
  created_at: Date; expires_at: Date; error: string | null; duration_seconds: number | null;
  audio_bytes: number | null; lease_owner: string | null; lease_until: Date | null;
}
export function chapterAudioEnabled() { return process.env.NODE_ENV !== "production"; }
let initialized = false;
export function chapterAudioReady() { return initialized; }

export async function initializeChapterAudio() {
  if (!chapterAudioEnabled()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chapter_audio_jobs (
      id uuid PRIMARY KEY, title text NOT NULL, creator_id text NOT NULL, creator_name text NOT NULL,
      voice text NOT NULL, status text NOT NULL DEFAULT 'queued', word_count integer NOT NULL,
      total_chunks integer NOT NULL, completed_chunks integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
      error text, duration_seconds double precision, audio_bytes integer,
      lease_owner text, lease_until timestamptz, cleaned_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS chapter_audio_jobs_queue_idx ON chapter_audio_jobs(status, expires_at);
  `);
  initialized = true;
}
export function publicChapter(row: ChapterRow) {
  return {
    id: row.id, title: row.title, voice: row.voice, status: row.status, wordCount: row.word_count,
    totalChunks: row.total_chunks, completedChunks: row.completed_chunks,
    creatorName: row.creator_name, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    error: row.error, durationSeconds: row.duration_seconds, audioBytes: row.audio_bytes,
  };
}
export async function getChapter(id: string) {
  return (await pool.query<ChapterRow>("SELECT * FROM chapter_audio_jobs WHERE id=$1", [id])).rows[0];
}
