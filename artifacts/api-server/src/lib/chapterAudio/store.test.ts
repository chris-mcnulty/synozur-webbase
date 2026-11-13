import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { speFileStorage } from "../storage/spe/fileStorage";
import { SpeGraphRequestError } from "../storage/spe/graphClient";
import { initializeChapterStorage, saveChapterFile, readChapterFile, readChapterAudioRange, chapterFileExists, deleteChapterFiles } from "./store";

test("private chapter SPE references survive container changes and cleanup retries", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  await initializeChapterStorage();
  const id = randomUUID();
  const key = `jobs/${id}/source.txt`;
  const bytes = Buffer.from("Private storage test passage.");
  const methods = { storeFile: speFileStorage.storeFile, getFile: speFileStorage.getFile,
    getMetadata: speFileStorage.getMetadata, deleteFile: speFileStorage.deleteFile };
  let upload = 0;
  let failDelete = false;
  const removed: string[] = [];
  try {
    speFileStorage.storeFile = async options => {
      assert.equal(options.documentType, "chapter-audio");
      assert.deepEqual(options.body, bytes);
      return { containerId: "original-container", itemId: `private-${++upload}`, size: bytes.length, contentType: "text/plain" };
    };
    speFileStorage.getFile = async (item, container) => {
      assert.equal(item, "private-2");
      assert.equal(container, "original-container");
      return new Response(bytes);
    };
    speFileStorage.getMetadata = async (_item, container) => {
      assert.equal(container, "original-container");
      throw new SpeGraphRequestError("Missing item", 404, "");
    };
    speFileStorage.deleteFile = async (item, container) => {
      assert.equal(container, "original-container");
      if (failDelete) throw new SpeGraphRequestError("Provider unavailable", 503, "");
      removed.push(item);
    };
    assert.equal(await chapterFileExists(key), false);
    await saveChapterFile(key, bytes, "text/plain");
    await saveChapterFile(key, bytes, "text/plain");
    assert.deepEqual(removed, ["private-1"]);
    assert.deepEqual(await readChapterFile(key), bytes);
    const savedGetFile = speFileStorage.getFile;
    speFileStorage.getFile = async (item, container, range) => {
      assert.equal(item, "private-2");
      assert.equal(container, "original-container");
      assert.equal(range, "bytes=0-4");
      return new Response(bytes.subarray(0, 5), { status: 206, headers: { "content-range": `bytes 0-4/${bytes.length}` } });
    };
    assert.deepEqual(await readChapterAudioRange(key, 0, 4, bytes.length), bytes.subarray(0, 5));
    speFileStorage.getFile = async () => new Response(bytes);
    await assert.rejects(readChapterAudioRange(key, 0, 4, bytes.length), /requested audio range/);
    speFileStorage.getFile = async () => new Response(bytes.subarray(0, 1), { status: 206, headers: { "content-range": `bytes 0-4/${bytes.length}` } });
    await assert.rejects(readChapterAudioRange(key, 0, 4, bytes.length), /Incomplete/);
    speFileStorage.getFile = savedGetFile;
    assert.equal(await chapterFileExists(key), false);
    failDelete = true;
    await assert.rejects(deleteChapterFiles(id));
    assert.equal((await pool.query("SELECT 1 FROM chapter_audio_files WHERE file_key=$1", [key])).rowCount, 1);
    failDelete = false;
    speFileStorage.deleteFile = async () => { throw new SpeGraphRequestError("Already deleted", 404, ""); };
    await deleteChapterFiles(id);
    assert.equal((await pool.query("SELECT 1 FROM chapter_audio_files WHERE file_key=$1", [key])).rowCount, 0);
    await assert.rejects(saveChapterFile("../public/leak.txt", bytes, "text/plain"), /Invalid/);
  } finally {
    Object.assign(speFileStorage, methods);
    await pool.query("DELETE FROM chapter_audio_files WHERE file_key=$1", [key]);
    await pool.end();
  }
});
