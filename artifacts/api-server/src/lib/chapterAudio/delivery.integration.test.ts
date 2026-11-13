import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { pool } from "@workspace/db";
import router from "../../routes/chapterAudio";
import { initializeChapterAudio } from "./repository";
import { speFileStorage } from "../storage/spe/fileStorage";
import { CHAPTER_AUDIO_RANGE_BYTES } from "./delivery";
import { logger } from "../logger";

test("HTTP audio delivery is bounded and private, with valid seek headers and bytes", async () => {
  const query = pool.query;
  const getFile = speFileStorage.getFile;
  const id = "00000000-0000-4000-8000-000000000001";
  const bytes = Buffer.alloc(3 * CHAPTER_AUDIO_RANGE_BYTES + 17, 123);
  let reads = 0;
  let upstreamBroken = false;
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    // Isolated HTTP test: no SQL, credentials, storage writes or speech calls.
    pool.query = (async (sql: string) => ({
      rows: sql.includes("SELECT * FROM chapter_audio_jobs")
        ? [{ id, status: "completed", expires_at: new Date(Date.now() + 60_000), audio_bytes: bytes.length, title: "Synthetic chapter" }]
        : sql.includes("SELECT * FROM chapter_audio_files")
          ? [{ file_key: `jobs/${id}/audio.mp3`, item_id: "private-item", container_id: "original-container" }]
          : [],
    })) as typeof pool.query;
    await initializeChapterAudio();
    speFileStorage.getFile = async (item, container, range) => {
      reads++;
      assert.equal(item, "private-item");
      assert.equal(container, "original-container");
      if (upstreamBroken) return new Response("Unavailable", { status: 503 });
      assert.ok(range);
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const start = Number(first), end = Number(last);
      return new Response(bytes.subarray(start, end + 1), {
        status: 206, headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` },
      });
    };
    const app = express();
    app.use((req, _res, next) => {
      req.log = logger;
      if (req.headers["x-test-role"]) req.authedUser = {
        id: "synthetic-editor", authProvider: "entra", externalSubject: null,
        email: null, displayName: null, avatarUrl: null, bio: null,
        roles: req.headers["x-test-role"] === "editor" ? ["editor"] : ["author"],
        effectiveCapabilities: [],
      };
      next();
    });
    app.use("/api", router);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/cms/chapter-audio/${id}/audio`;
    const request = (range: string, role = "editor") => fetch(url, { headers: { Range: range, "x-test-role": role } });
    let response = await fetch(url);
    assert.equal(response.status, 401);
    response = await request("bytes=0-", "guest");
    assert.equal(response.status, 403);
    assert.equal(reads, 0);
    response = await request("bytes=0-");
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("content-range"), `bytes 0-${CHAPTER_AUDIO_RANGE_BYTES - 1}/${bytes.length}`);
    assert.match(response.headers.get("cache-control")!, /private.*no-store.*no-transform/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(0, CHAPTER_AUDIO_RANGE_BYTES));
    response = await request("bytes=-17");
    assert.equal(response.status, 206);
    assert.equal((await response.arrayBuffer()).byteLength, 17);
    response = await request(`bytes=${bytes.length + 1}-`);
    assert.equal(response.status, 416);
    upstreamBroken = true;
    response = await request("bytes=0-1");
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type")!, /json/);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    pool.query = query;
    speFileStorage.getFile = getFile;
    await pool.end();
  }
});
