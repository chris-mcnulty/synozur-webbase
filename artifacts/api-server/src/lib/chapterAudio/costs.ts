import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { billableCharacters, summarizeUsage, type SpeechRate, type UsageRow, type ChapterAudioJobCost, type ChapterAudioMonthlyCosts, type ChapterAudioEstimate } from "./costMath";

export async function initializeChapterCosts() {
  await pool.query(`
    ALTER TABLE chapter_audio_jobs ADD COLUMN IF NOT EXISTS initial_estimate jsonb;
    ALTER TABLE chapter_audio_jobs ADD COLUMN IF NOT EXISTS metering_version integer NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS chapter_audio_rates (
      id uuid PRIMARY KEY, per_million numeric(18,6) NOT NULL CHECK(per_million>=0),
      currency text NOT NULL, effective_from timestamptz NOT NULL, saved_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS chapter_audio_metering (
      id integer PRIMARY KEY CHECK(id=1), started_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO chapter_audio_metering(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS chapter_audio_usage (
      id uuid PRIMARY KEY, job_id uuid, kind text NOT NULL, actor_id text NOT NULL, actor_label text NOT NULL,
      voice text NOT NULL, section_index integer, characters integer NOT NULL CHECK(characters>=0),
      outcome text NOT NULL, is_retry boolean NOT NULL DEFAULT false,
      rate_id uuid, rate_per_million numeric(18,6), currency text,
      started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS chapter_audio_usage_job_idx ON chapter_audio_usage(job_id);
    CREATE INDEX IF NOT EXISTS chapter_audio_usage_month_idx ON chapter_audio_usage(started_at);
    INSERT INTO chapter_audio_rates(id,per_million,currency,effective_from)
      SELECT '813acb39-2c58-4efc-9662-d4c21fc119cd',15,'USD',now()
      WHERE NOT EXISTS(SELECT 1 FROM chapter_audio_rates)
      ON CONFLICT DO NOTHING;
  `);
}
function publicRate(row: { id: string; per_million: string; currency: string; effective_from: Date; saved_at: Date }): SpeechRate {
  return { id: row.id, perMillion: Number(row.per_million), currency: row.currency, effectiveFrom: row.effective_from.toISOString(), savedAt: row.saved_at.toISOString() };
}
export async function currentSpeechRate(): Promise<SpeechRate | null> {
  const { rows } = await pool.query("SELECT * FROM chapter_audio_rates WHERE effective_from<=now() ORDER BY effective_from DESC,saved_at DESC,id DESC LIMIT 1");
  return rows[0] ? publicRate(rows[0]) : null;
}
export async function saveSpeechRate(perMillion: number, currency: string, effectiveFrom: Date) {
  const { rows } = await pool.query("INSERT INTO chapter_audio_rates(id,per_million,currency,effective_from) VALUES($1,$2,$3,$4) RETURNING *", [randomUUID(), perMillion, currency, effectiveFrom]);
  return publicRate(rows[0]);
}
export interface SpeechUsageContext {
  jobId?: string; sectionIndex?: number;
  actorId: string; actorLabel: string;
}
export async function beginSpeechAttempt(text: string, voice: string, context: SpeechUsageContext) {
  const rate = await currentSpeechRate();
  const id = randomUUID();
  // Fail closed: never make a paid request if its usage cannot be recorded.
  // A crash between this durable intent and the network call is conservatively
  // uncertain; no claim is made that every recorded attempt was actually billed.
  await pool.query(`INSERT INTO chapter_audio_usage
    (id,job_id,kind,actor_id,actor_label,voice,section_index,characters,outcome,is_retry,rate_id,rate_per_million,currency)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'started',
      EXISTS(SELECT 1 FROM chapter_audio_usage WHERE job_id=$2 AND section_index=$7 AND kind='chapter'),
      $9,$10,$11)`,
  [id, context.jobId ?? null, context.jobId ? "chapter" : "sample", context.actorId, context.actorLabel,
    voice, context.sectionIndex ?? null, billableCharacters(text, voice), rate?.id ?? null, rate?.perMillion ?? null, rate?.currency ?? null]);
  return id;
}
export async function finishSpeechAttempt(id: string, outcome: "succeeded" | "rejected" | "uncertain") {
  await pool.query("UPDATE chapter_audio_usage SET outcome=$2,finished_at=now() WHERE id=$1", [id, outcome]);
}
export async function recordReusedSection(voice: string, context: SpeechUsageContext) {
  await pool.query(`INSERT INTO chapter_audio_usage
    (id,job_id,kind,actor_id,actor_label,voice,section_index,characters,outcome,finished_at)
    VALUES($1,$2,'reuse',$3,$4,$5,$6,0,'succeeded',now())`,
  [randomUUID(), context.jobId, context.actorId, context.actorLabel, voice, context.sectionIndex]);
}
export async function jobCostMap(jobs: { id: string; initial_estimate?: ChapterAudioEstimate | null; metering_version?: number }[]) {
  const result = new Map<string, ChapterAudioJobCost>();
  if (!jobs.length) return result;
  const { rows } = await pool.query<UsageRow>("SELECT * FROM chapter_audio_usage WHERE job_id=ANY($1::uuid[])", [jobs.map(j => j.id)]);
  const grouped = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.job_id!) ?? []; group.push(row); grouped.set(row.job_id!, group);
  }
  for (const job of jobs) result.set(job.id, {
    initialEstimate: job.initial_estimate ?? null,
    usage: summarizeUsage(grouped.get(job.id) ?? []),
    legacyUsageGap: job.metering_version !== 1,
  });
  return result;
}
export async function monthlySpeechCosts(month: string): Promise<ChapterAudioMonthlyCosts> {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  const { rows } = await pool.query<UsageRow>("SELECT * FROM chapter_audio_usage WHERE started_at >= $1 AND started_at < $2 ORDER BY started_at,id", [start, end]);
  const { rows: state } = await pool.query("SELECT started_at FROM chapter_audio_metering WHERE id=1");
  const group = (key: "actor_id" | "voice") => {
    const groups = new Map<string, UsageRow[]>();
    for (const row of rows) { const list = groups.get(row[key]) ?? []; list.push(row); groups.set(row[key], list); }
    return [...groups].map(([id, list]) => ({ id, label: key === "actor_id" ? list[list.length - 1]!.actor_label : id, usage: summarizeUsage(list) }));
  };
  return { month, timezone: "UTC", coverageStartedAt: state[0].started_at.toISOString(), usage: summarizeUsage(rows), byUser: group("actor_id"), byVoice: group("voice") };
}
