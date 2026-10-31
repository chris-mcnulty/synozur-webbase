import { pool } from "@workspace/db";
import type { ChapterAudioEstimate, ChapterAudioJobCost } from "./costMath";
import { initializeChapterCosts } from "./costs";
import { initializeChapterStorage } from "./store";
import type { ChapterFailure, ChapterStage } from "./diagnostics";

export type ChapterStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "expired" | "deleting";
export interface ChapterRow {
  id: string; title: string; creator_id: string; creator_name: string; voice: string;
  status: ChapterStatus; word_count: number; total_chunks: number; completed_chunks: number;
  created_at: Date; expires_at: Date; error: string | null; duration_seconds: number | null;
  audio_bytes: number | null; lease_owner: string | null; lease_until: Date | null;
  initial_estimate?: ChapterAudioEstimate | null; metering_version?: number;
  processing_stage?: ChapterStage | null; diagnostics?: ChapterFailure[];
}
export function chapterAudioEnabled() { return true; }
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
    ALTER TABLE chapter_audio_jobs ADD COLUMN IF NOT EXISTS processing_stage text,
      ADD COLUMN IF NOT EXISTS diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb;
  `);
  await initializeChapterCosts();
  await initializeChapterStorage();
  await pool.query(`CREATE TABLE IF NOT EXISTS chapter_audio_publications (
    job_id uuid PRIMARY KEY REFERENCES chapter_audio_jobs(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now(),
    file_key text, audio_bytes integer, report jsonb, error text
  )`);
  initialized = true;
}
export function publicChapter(row: ChapterRow, cost?: ChapterAudioJobCost) {
  return {
    id: row.id, title: row.title, voice: row.voice, status: row.status, wordCount: row.word_count,
    totalChunks: row.total_chunks, completedChunks: row.completed_chunks,
    creatorName: row.creator_name, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    error: row.error, durationSeconds: row.duration_seconds, audioBytes: row.audio_bytes,
    processingStage: row.processing_stage ?? null, diagnostics: row.diagnostics ?? [],
    cost,
  };
}
export async function getChapter(id: string) {
  return (await pool.query<ChapterRow>("SELECT * FROM chapter_audio_jobs WHERE id=$1", [id])).rows[0];
}

export async function appendChapterFailure(id: string, token: string, event: ChapterFailure) {
  return pool.query(`UPDATE chapter_audio_jobs SET diagnostics=(
    SELECT jsonb_agg(entry ORDER BY ordinal) FROM (
      SELECT value AS entry, ordinality AS ordinal
      FROM jsonb_array_elements(coalesce(diagnostics,'[]'::jsonb) || jsonb_build_array($3::jsonb)) WITH ORDINALITY
      ORDER BY ordinality DESC LIMIT 20
    ) retained)
    WHERE id=$1 AND lease_owner=$2 AND status='processing' AND expires_at>now() AND lease_until>now()`,
  [id, token, JSON.stringify(event)]);
}
