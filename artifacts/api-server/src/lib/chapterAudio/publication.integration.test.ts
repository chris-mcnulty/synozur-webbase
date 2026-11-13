import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import express from "express";
import ffmpeg from "ffmpeg-static";
import { pool } from "@workspace/db";
import { initializeChapterAudio } from "./repository";
import { processNextPublication } from "./publication";
import { saveChapterFile, readChapterFile, deleteChapterFiles } from "./store";
import { speFileStorage } from "../storage/spe/fileStorage";
import router from "../../routes/chapterAudio";
import { logger } from "../logger";
import { GetChapterPublicationResponse } from "@workspace/api-zod";
import { assembleChapter } from "./assemble";

test("private publication queue, restart recovery, encoded report, range download and retention use synthetic audio only", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const id = randomUUID();
  const originals = {
    storeFile: speFileStorage.storeFile, getFile: speFileStorage.getFile, deleteFile: speFileStorage.deleteFile,
  };
  const query = pool.query.bind(pool);
  const files = new Map<string, Buffer>();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let initialized = false;
  try {
    await initializeChapterAudio();
    initialized = true;
    const { stdout: source } = await promisify(execFile)(ffmpeg!, [
      "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000,volume=0.5",
      "-t", "1", "-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1",
    ], { encoding: "buffer", timeout: 10000 });
    await query(`INSERT INTO chapter_audio_jobs(id,title,creator_id,creator_name,voice,status,word_count,total_chunks,audio_bytes)
      VALUES($1,'Synthetic publication check','test','Test','test','completed',1,1,$2)`, [id, source.length]);
    speFileStorage.storeFile = async options => {
      assert.equal(options.documentType, "chapter-audio");
      const item = randomUUID();
      files.set(item, Buffer.from(options.body as Buffer));
      return { itemId: item, containerId: "synthetic-private", size: (options.body as Buffer).length, contentType: "audio/mpeg" };
    };
    speFileStorage.getFile = async (item, container, range) => {
      assert.equal(container, "synthetic-private");
      const bytes = files.get(item);
      assert.ok(bytes);
      if (!range) return new Response(bytes);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const start = Number(match[1]), end = Number(match[2]);
      return new Response(bytes.subarray(start, end + 1), {
        status: 206, headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` },
      });
    };
    speFileStorage.deleteFile = async (item, container) => {
      assert.equal(container, "synthetic-private");
      files.delete(item);
    };
    await saveChapterFile(`jobs/${id}/audio.mp3`, source, "audio/mpeg");
    // Scope the real queue SQL to this synthetic job; never claim another user's work.
    pool.query = ((sql: string, values?: unknown[]) => {
      if (sql.includes("FOR UPDATE OF j SKIP LOCKED")) {
        sql = sql.replace("WHERE j.status='completed'", `WHERE j.id='${id}' AND j.status='completed'`);
      }
      return query(sql, values);
    }) as typeof pool.query;
    const app = express();
    app.use((req, _res, next) => {
      req.log = logger;
      if (req.headers["x-test-role"]) req.authedUser = {
        id: "synthetic-editor", authProvider: "entra", externalSubject: null,
        email: null, displayName: null, avatarUrl: null, bio: null,
        roles: req.headers["x-test-role"] === "editor" ? ["editor"] : ["author"], effectiveCapabilities: [],
      };
      next();
    });
    app.use("/api", router);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/cms/chapter-audio/${id}/publication`;
    const request = (method = "GET", role = "editor", suffix = "", range?: string) =>
      fetch(url + suffix, { method, headers: { "x-test-role": role, ...(range ? { Range: range } : {}) } });
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await request("POST", "guest")).status, 403);
    assert.equal(GetChapterPublicationResponse.parse(await (await request()).json()).status, "idle");
    assert.equal((await request("POST")).status, 202);
    assert.equal(GetChapterPublicationResponse.parse(await (await request()).json()).status, "queued");
    await request("POST"); // Idempotent duplicate; no extra queue entries.
    assert.equal((await query("SELECT count(*) AS n FROM chapter_audio_publications WHERE job_id=$1", [id])).rows[0].n, "1");
    // A persisted processing task with a live lease cannot be claimed twice.
    await query("UPDATE chapter_audio_publications SET status='processing' WHERE job_id=$1", [id]);
    await query("UPDATE chapter_audio_jobs SET lease_owner='crashed-worker',lease_until=now()+interval '5 minutes' WHERE id=$1", [id]);
    assert.equal(await processNextPublication(), false);
    await query("UPDATE chapter_audio_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [id]);
    assert.equal(await processNextPublication(), true);
    let response = await request();
    const raw: unknown = await response.json();
    const ready = GetChapterPublicationResponse.parse(raw);
    assert.equal(ready.status, "ready");
    assert.ok(ready.report);
    assert.equal(ready.report.sampleRate, 44100);
    assert.ok(ready.report.rmsDb >= -23 && ready.report.rmsDb <= -18);
    assert.ok(ready.report.peakDb <= -3);
    assert.equal(ready.report.listeningChecks?.noiseFloor.status, "unmeasurable");
    assert.equal(ready.report.listeningChecks?.leadingRoomTone.status, "unmeasurable");
    assert.ok(ready.report.listeningChecks?.requirementsUrl.startsWith("https://help.acx.com/"));
    assert.ok(typeof raw === "object" && raw !== null && !("file_key" in raw)); // Storage references stay server-side.
    assert.match(response.headers.get("cache-control")!, /private.*no-store/);
    response = await request("GET", "editor", "/audio", "bytes=0-999");
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes 0-999/${ready.audioBytes}`);
    assert.equal((await response.arrayBuffer()).byteLength, 1000);
    assert.equal((await request("GET", "guest", "/audio", "bytes=0-9")).status, 403);
    assert.equal((await request("GET", "editor", "/audio")).status, 416);
    assert.deepEqual(await readChapterFile(`jobs/${id}/audio.mp3`), source);
    // Repeated preparation never re-encodes an already ready copy.
    assert.equal(GetChapterPublicationResponse.parse(await (await request("POST")).json()).status, "ready");
    // Future jobs must master from the lossless source, not their listening MP3.
    const { stdout: wav } = await promisify(execFile)(ffmpeg!, [
      "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1",
    ], { encoding: "buffer", timeout: 10000 });
    const lossless = await assembleChapter([wav], true);
    assert.ok(lossless.source);
    await saveChapterFile(`jobs/${id}/section-pcm48-v1-0.wav`, wav, "audio/wav");
    await saveChapterFile(`jobs/${id}/source-pcm48-v1.flac`, lossless.source, "audio/flac");
    await saveChapterFile(`jobs/${id}/audio.mp3`, Buffer.from("Not a valid mastering source"), "audio/mpeg");
    await query("UPDATE chapter_audio_jobs SET source_format='pcm48-v1',source_bytes=$2 WHERE id=$1", [id, lossless.source.length]);
    await query("UPDATE chapter_audio_publications SET status='queued' WHERE job_id=$1", [id]);
    assert.equal(await processNextPublication(), true);
    assert.equal(GetChapterPublicationResponse.parse(await (await request()).json()).status, "ready");
    // Missing lossless metadata fails explicitly; no silent MP3 downgrade.
    await query("UPDATE chapter_audio_jobs SET source_bytes=null WHERE id=$1", [id]);
    await query("UPDATE chapter_audio_publications SET status='queued' WHERE job_id=$1", [id]);
    assert.equal(await processNextPublication(), true);
    assert.equal(GetChapterPublicationResponse.parse(await (await request()).json()).status, "failed");
    await query("UPDATE chapter_audio_jobs SET source_bytes=$2 WHERE id=$1", [id, lossless.source.length]);
    assert.equal((await request("POST")).status, 202);
    assert.equal(await processNextPublication(), true);
    assert.equal(GetChapterPublicationResponse.parse(await (await request()).json()).status, "ready");
    await query("UPDATE chapter_audio_jobs SET expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    assert.equal((await request()).status, 410);
    assert.equal((await request("POST")).status, 410);
    assert.equal((await request("GET", "editor", "/audio", "bytes=0-9")).status, 410);
    await deleteChapterFiles(id);
    assert.equal(files.size, 0);
    await query("DELETE FROM chapter_audio_jobs WHERE id=$1", [id]);
    assert.equal((await query("SELECT 1 FROM chapter_audio_publications WHERE job_id=$1", [id])).rowCount, 0);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    pool.query = query as typeof pool.query;
    if (initialized) {
      await deleteChapterFiles(id);
      await query("DELETE FROM chapter_audio_jobs WHERE id=$1", [id]);
    }
    Object.assign(speFileStorage, originals);
    await pool.end();
  }
});
