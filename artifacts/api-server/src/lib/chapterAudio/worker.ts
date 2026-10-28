import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { chapterAudioEnabled, chapterAudioReady, type ChapterRow } from "./repository";
import { readChapterFile, saveChapterFile, chapterFileExists, deleteChapterFiles } from "./store";
import { splitNarration } from "./text";
import { renderChapterSection, ChapterSpeechError } from "./speech";
import { assembleChapter } from "./assemble";

async function owned(id: string, token: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM chapter_audio_jobs WHERE id=$1 AND lease_owner=$2 AND status='processing' AND expires_at>now() AND lease_until>now()", [id, token])).rowCount === 1;
}

async function processChapter(row: ChapterRow, token: string) {
  const heartbeat = setInterval(() => {
    void pool.query("UPDATE chapter_audio_jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_owner=$2 AND status='processing'", [row.id, token])
      .catch(() => logger.warn({ chapterId: row.id }, "Chapter lease renewal failed"));
  }, 20_000);
  try {
    const text = (await readChapterFile(`jobs/${row.id}/source.txt`)).toString("utf8");
    const sections = splitNarration(text);
    const buffers: Buffer[] = [];
    for (let i = 0; i < sections.length; i++) {
      if (!await owned(row.id, token)) return;
      const key = `jobs/${row.id}/section-${i}.mp3`;
      let bytes: Buffer;
      if (await chapterFileExists(key)) bytes = await readChapterFile(key);
      else {
        let attempt = 0;
        for (;;) {
          try { bytes = await renderChapterSection(sections[i]!, row.voice); break; }
          catch (error) {
            attempt++;
            const transient = !(error instanceof ChapterSpeechError) || error.retryable;
            if (!transient || attempt >= 3 || !await owned(row.id, token)) throw error;
            await new Promise(resolve => setTimeout(resolve, attempt * 5000));
          }
        }
        if (!await owned(row.id, token)) return;
        await saveChapterFile(key, bytes!, "audio/mpeg");
      }
      buffers.push(bytes!);
      await pool.query("UPDATE chapter_audio_jobs SET completed_chunks=$3 WHERE id=$1 AND lease_owner=$2 AND status='processing'", [row.id, token, i + 1]);
    }
    if (!await owned(row.id, token)) return;
    const result = await assembleChapter(buffers);
    if (!await owned(row.id, token)) return;
    await saveChapterFile(`jobs/${row.id}/audio.mp3`, result.audio, "audio/mpeg");
    await pool.query(`UPDATE chapter_audio_jobs SET status='completed',error=null,duration_seconds=$3,audio_bytes=$4
      WHERE id=$1 AND lease_owner=$2 AND status='processing' AND expires_at>now()`, [row.id, token, result.duration, result.audio.length]);
    logger.info({ chapterId: row.id }, "Chapter audio completed");
  } catch (error) {
    const message = error instanceof ChapterSpeechError ? error.message : "Chapter rendering failed. Completed sections are retained; retry to resume. If this continues, ask an administrator to check speech, storage, and the encoder.";
    await pool.query("UPDATE chapter_audio_jobs SET status='failed',error=$3 WHERE id=$1 AND lease_owner=$2 AND status='processing'", [row.id, token, message]);
    // Do not log raw errors or provider bodies that might contain chapter text.
    logger.warn({ chapterId: row.id }, "Chapter audio processing failed");
  } finally {
    clearInterval(heartbeat);
    await pool.query("UPDATE chapter_audio_jobs SET lease_owner=null,lease_until=null WHERE id=$1 AND lease_owner=$2", [row.id, token]);
  }
}

async function cleanupChapters() {
  // Expiry immediately removes access, even when storage deletion needs retries.
  await pool.query("UPDATE chapter_audio_jobs SET status='expired',error=null WHERE expires_at<=now() AND status NOT IN ('expired','deleting')");
  const rows = (await pool.query<ChapterRow>(`SELECT * FROM chapter_audio_jobs
    WHERE (status='deleting' OR (status='expired' AND cleaned_at IS NULL))
    AND (lease_until IS NULL OR lease_until<now()) LIMIT 25`)).rows;
  for (const row of rows) {
    try {
      await deleteChapterFiles(row.id);
      if (row.status === "deleting") await pool.query("DELETE FROM chapter_audio_jobs WHERE id=$1 AND status='deleting'", [row.id]);
      else await pool.query(`UPDATE chapter_audio_jobs SET cleaned_at=now(), title='Expired chapter', creator_name='',
        creator_id='', completed_chunks=0,audio_bytes=null,duration_seconds=null
        WHERE id=$1 AND status='expired'`, [row.id]);
    } catch { logger.warn({ chapterId: row.id }, "Chapter deletion will be retried"); }
  }
}

export function startChapterAudioWorker() {
  let stopping = false;
  let busy = false;
  async function tick() {
    if (stopping || busy || !chapterAudioEnabled() || !chapterAudioReady()) return;
    busy = true;
    try {
      await cleanupChapters();
      const token = randomUUID();
      // SKIP LOCKED and persisted leases make this safe across API instances and restarts.
      const result = await pool.query<ChapterRow>(`UPDATE chapter_audio_jobs SET status='processing',
        lease_owner=$1,lease_until=now()+interval '5 minutes',error=null
        WHERE id=(SELECT id FROM chapter_audio_jobs
          WHERE status IN ('queued','processing') AND expires_at>now()
          AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at
          FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [token]);
      if (result.rows[0]) await processChapter(result.rows[0], token);
    } catch { logger.warn("Chapter audio worker could not complete its queue check"); }
    finally { busy = false; }
  }
  const timer = chapterAudioEnabled() ? setInterval(() => void tick(), 3000) : null;
  return { stop() { stopping = true; if (timer) clearInterval(timer); } };
}
