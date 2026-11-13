import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { readChapterAudioRange, saveChapterFile } from "./store";
import { masterPublication, PublicationError } from "./publicationMaster";
import { LOSSLESS_SOURCE, LEGACY_SOURCE } from "./formats";

export async function getPublication(id: string) {
  return (await pool.query(`SELECT status,error,audio_bytes AS "audioBytes",report,file_key
    FROM chapter_audio_publications WHERE job_id=$1`, [id])).rows[0] ?? { status: "idle" };
}

// Runs within the existing chapter worker. Persisted queue + existing chapter
// leases resume after restarts, and stop retention deletion while a copy is made.
export async function processNextPublication(): Promise<boolean> {
  const token = randomUUID();
  const { rows } = await pool.query<{ id: string; audio_bytes: number; source_format: string; source_bytes: number | null }>(`
    UPDATE chapter_audio_jobs SET lease_owner=$1,lease_until=now()+interval '5 minutes'
    WHERE id=(SELECT j.id FROM chapter_audio_jobs j JOIN chapter_audio_publications p ON p.job_id=j.id
      WHERE j.status='completed' AND j.expires_at>now() AND p.status IN ('queued','processing')
      AND (j.lease_until IS NULL OR j.lease_until<now()) ORDER BY p.created_at
      FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING id,audio_bytes,source_format,source_bytes`, [token]);
  const row = rows[0];
  if (!row) return false;
  async function owned() {
    return !!(await pool.query(`SELECT 1 FROM chapter_audio_jobs
      WHERE id=$1 AND lease_owner=$2 AND lease_until>now() AND status='completed' AND expires_at>now()`,
    [row!.id, token])).rowCount;
  }
  const heartbeat = setInterval(() => {
    void pool.query(`UPDATE chapter_audio_jobs SET lease_until=now()+interval '5 minutes'
      WHERE id=$1 AND lease_owner=$2 AND status='completed' AND expires_at>now() AND lease_until>now()`,
    [row.id, token]).catch(() => logger.warn({ chapterId: row.id }, "Publication lease renewal failed"));
  }, 20_000);
  try {
    if (!await owned()) return true;
    await pool.query(`UPDATE chapter_audio_publications SET status='processing',error=null
      WHERE job_id=$1 AND EXISTS(SELECT 1 FROM chapter_audio_jobs
        WHERE id=$1 AND lease_owner=$2 AND lease_until>now() AND status='completed' AND expires_at>now())`, [row.id, token]);
    const lossless = row.source_format === LOSSLESS_SOURCE;
    if (!lossless && row.source_format !== LEGACY_SOURCE) throw new PublicationError("The recording has an unsupported source format.");
    const size = lossless ? row.source_bytes : row.audio_bytes;
    const sourceKey = `jobs/${row.id}/${lossless ? "source-pcm48-v1.flac" : "audio.mp3"}`;
    // Never silently master a new chapter from its lossy listening copy.
    if (!size || !Number.isSafeInteger(size) || size <= 0) throw new PublicationError("The original recording has no valid source file size.");
    const parts: Buffer[] = [];
    for (let start = 0; start < size; start += 1024 * 1024) {
      if (!await owned()) return true;
      parts.push(await readChapterAudioRange(sourceKey, start,
        Math.min(start + 1024 * 1024 - 1, size - 1), size));
    }
    const result = await masterPublication(Buffer.concat(parts));
    if (!await owned()) return true;
    const key = `jobs/${row.id}/publication-${token}.mp3`;
    await saveChapterFile(key, result.audio, "audio/mpeg");
    await pool.query(`UPDATE chapter_audio_publications SET status='ready',error=null,file_key=$3,audio_bytes=$4,report=$5
      WHERE job_id=$1 AND EXISTS(SELECT 1 FROM chapter_audio_jobs
        WHERE id=$1 AND lease_owner=$2 AND lease_until>now() AND status='completed' AND expires_at>now())`,
    [row.id, token, key, result.audio.length, JSON.stringify(result.report)]);
  } catch (error) {
    const message = error instanceof PublicationError ? error.message :
      "Publication export failed during file transfer. Your original recording is unchanged; retry the export.";
    await pool.query(`UPDATE chapter_audio_publications SET status='failed',error=$3
      WHERE job_id=$1 AND EXISTS(SELECT 1 FROM chapter_audio_jobs WHERE id=$1 AND lease_owner=$2 AND lease_until>now())`,
    [row.id, token, message]);
    logger.warn({ chapterId: row.id }, "Chapter publication export failed");
  } finally {
    clearInterval(heartbeat);
    await pool.query("UPDATE chapter_audio_jobs SET lease_owner=null,lease_until=null WHERE id=$1 AND lease_owner=$2", [row.id, token]);
  }
  return true;
}
