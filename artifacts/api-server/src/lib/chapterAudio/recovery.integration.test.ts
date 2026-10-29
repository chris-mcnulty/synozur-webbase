import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { pool } from "@workspace/db";
import { ListChapterAudioResponse } from "@workspace/api-zod";
import { appendChapterFailure, getChapter, publicChapter } from "./repository";
import { assembleChapter } from "./assemble";

test("real encoder assembles synthetic audio without speech or storage requests", async () => {
  assert.ok(ffmpeg);
  const { stdout } = await promisify(execFile)(ffmpeg!, [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-t", "0.25", "-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1",
  ], { encoding: "buffer", timeout: 10_000 });
  const result = await assembleChapter([stdout, stdout]);
  assert.ok(result.audio.length > 100);
  assert.ok(result.duration >= 0.5 && result.duration < 2);
});

test("dev failure history is fenced, bounded, retained after retry and exposed through the API contract", {
  skip: process.env.RUN_CHAPTER_RECOVERY_INTEGRATION !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  const id = randomUUID(), token = randomUUID();
  try {
    await pool.query(`INSERT INTO chapter_audio_jobs
      (id,title,creator_id,creator_name,voice,status,word_count,total_chunks,lease_owner,lease_until)
      VALUES($1,'Synthetic recovery check','test','Test','test','processing',1,1,$2,now()+interval '5 minutes')`, [id, token]);
    for (let i = 1; i <= 25; i++) {
      await appendChapterFailure(id, token, {
        at: new Date().toISOString(), stage: "assembly", code: "encoder_timeout",
        attempt: i, elapsedMs: 1, willRetry: i < 25,
      });
    }
    assert.equal((await appendChapterFailure(id, "lost-lease", {
      at: new Date().toISOString(), stage: "final_save", code: "storage_http_503",
      attempt: 999, elapsedMs: 1, willRetry: false,
    })).rowCount, 0);
    let row = await getChapter(id);
    assert.equal(row.diagnostics!.length, 20);
    assert.equal(row.diagnostics![0].attempt, 6);
    assert.equal(row.diagnostics!.at(-1)!.attempt, 25);
    // Retry and success clear the current error, not historical diagnostics.
    await pool.query("UPDATE chapter_audio_jobs SET status='failed',error='synthetic',processing_stage='assembly' WHERE id=$1", [id]);
    await pool.query("UPDATE chapter_audio_jobs SET status='queued',error=null,processing_stage=null WHERE id=$1", [id]);
    await pool.query("UPDATE chapter_audio_jobs SET status='completed',error=null,completed_chunks=1 WHERE id=$1", [id]);
    row = await getChapter(id);
    const exposed = ListChapterAudioResponse.shape.jobs.element.parse(publicChapter(row));
    assert.equal(exposed.status, "completed");
    assert.equal(exposed.error, null);
    assert.equal(exposed.diagnostics!.length, 20);
    assert.equal(exposed.diagnostics!.at(-1)!.code, "encoder_timeout");
  } finally {
    await pool.query("DELETE FROM chapter_audio_jobs WHERE id=$1", [id]);
    await pool.end();
  }
});
