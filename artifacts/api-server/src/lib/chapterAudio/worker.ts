import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../logger";
import { chapterAudioEnabled, chapterAudioReady, appendChapterFailure, type ChapterRow } from "./repository";
import { readChapterFile, saveChapterFile, chapterFileExists, deleteChapterFiles } from "./store";
import { splitNarration } from "./text";
import { renderChapterSection, ChapterSpeechError } from "./speech";
import { assembleChapter } from "./assemble";
import { recordReusedSection } from "./costs";
import { finalizeChapter } from "./finalize";
import { ChapterLeaseLost, CHAPTER_STAGE_LABELS, classifyChapterFailure, type ChapterFailure, type ChapterStage } from "./diagnostics";

async function owned(id: string, token: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM chapter_audio_jobs WHERE id=$1 AND lease_owner=$2 AND status='processing' AND expires_at>now() AND lease_until>now()", [id, token])).rowCount === 1;
}

async function processChapter(row: ChapterRow, token: string) {
  let stage: ChapterStage = "source_read";
  let stageStarted = Date.now();
  let failureRecorded = false;
  async function setStage(next: ChapterStage) {
    stage = next; stageStarted = Date.now(); failureRecorded = false;
    const result = await pool.query(`UPDATE chapter_audio_jobs SET processing_stage=$3
      WHERE id=$1 AND lease_owner=$2 AND status='processing' AND lease_until>now() AND expires_at>now()`,
    [row.id, token, stage]);
    if (!result.rowCount) throw new ChapterLeaseLost();
    logger.info({ chapterId: row.id, stage }, "Chapter audio stage started");
  }
  async function recordFailure(event: ChapterFailure) {
    // Only allowlisted classifications and numeric timing go to logs/history.
    // Keep the last 20 failures across automatic and manual retries.
    logger.warn({ chapterId: row.id, ...event }, "Chapter audio stage failed");
    failureRecorded = true;
    try {
      await appendChapterFailure(row.id, token, event);
    } catch { logger.warn({ chapterId: row.id, stage: event.stage }, "Chapter diagnostic persistence unavailable"); }
  }
  const heartbeat = setInterval(() => {
    void pool.query("UPDATE chapter_audio_jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_owner=$2 AND status='processing'", [row.id, token])
      .catch(() => logger.warn({ chapterId: row.id }, "Chapter lease renewal failed"));
  }, 20_000);
  try {
    await setStage("source_read");
    const text = (await readChapterFile(`jobs/${row.id}/source.txt`)).toString("utf8");
    const sections = splitNarration(text);
    const buffers: Buffer[] = [];
    for (let i = 0; i < sections.length; i++) {
      if (!await owned(row.id, token)) return;
      const key = `jobs/${row.id}/section-${i}.mp3`;
      const usageContext = { jobId: row.id, sectionIndex: i, actorId: row.creator_id, actorLabel: row.creator_name };
      let bytes: Buffer;
      await setStage("section_read");
      if (await chapterFileExists(key)) {
        bytes = await readChapterFile(key);
        await recordReusedSection(row.voice, usageContext);
      }
      else {
        await setStage("speech");
        let attempt = 0;
        for (;;) {
          try { bytes = await renderChapterSection(sections[i]!, row.voice, usageContext); break; }
          catch (error) {
            attempt++;
            const transient = !(error instanceof ChapterSpeechError) || error.retryable;
            if (!transient || attempt >= 3 || !await owned(row.id, token)) throw error;
            await new Promise(resolve => setTimeout(resolve, attempt * 5000));
          }
        }
        if (!await owned(row.id, token)) return;
        await setStage("section_save");
        await saveChapterFile(key, bytes!, "audio/mpeg");
      }
      buffers.push(bytes!);
      await setStage("section_progress");
      await pool.query("UPDATE chapter_audio_jobs SET completed_chunks=$3 WHERE id=$1 AND lease_owner=$2 AND status='processing'", [row.id, token, i + 1]);
    }
    if (!await owned(row.id, token)) return;
    await finalizeChapter(buffers, {
      assemble: assembleChapter,
      save: result => saveChapterFile(`jobs/${row.id}/audio.mp3`, result.audio, "audio/mpeg"),
      complete: async result => {
        const updated = await pool.query(`UPDATE chapter_audio_jobs SET status='completed',error=null,duration_seconds=$3,audio_bytes=$4
          WHERE id=$1 AND lease_owner=$2 AND status='processing' AND expires_at>now() AND lease_until>now()`,
        [row.id, token, result.duration, result.audio.length]);
        if (!updated.rowCount) throw new ChapterLeaseLost();
      },
      owned: () => owned(row.id, token),
      stage: setStage, failure: recordFailure,
      success: (stage, attempt, elapsedMs) => logger.info({ chapterId: row.id, stage, attempt, elapsedMs }, "Chapter audio stage completed"),
    });
    logger.info({ chapterId: row.id }, "Chapter audio completed");
  } catch (error) {
    if (error instanceof ChapterLeaseLost) return;
    if (!failureRecorded) await recordFailure({
      at: new Date().toISOString(), stage, code: error instanceof ChapterSpeechError ? "speech_request_failed" : classifyChapterFailure(error).code,
      attempt: 1, elapsedMs: Date.now() - stageStarted, willRetry: false,
    });
    const message = error instanceof ChapterSpeechError ? error.message :
      `${CHAPTER_STAGE_LABELS[stage]} failed. Completed sections are retained; retry to resume. See processing diagnostics for the failure stage.`;
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
