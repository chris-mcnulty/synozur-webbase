import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { speFileStorage } from "../storage/spe/fileStorage";
import { readSpeGraphConfigFromEnv, SpeGraphRequestError } from "../storage/spe/graphClient";

// This registry is intentionally separate from media/assets. Public storage
// endpoints cannot resolve these references; only chapter routes serve bytes.
interface ChapterFile { file_key: string; item_id: string; container_id: string }
function validateKey(key: string) {
  if (!/^(?:jobs\/[a-f0-9-]{36}\/(?:source\.txt|section-\d+\.mp3|section-pcm48-v1-\d+\.wav|source-pcm48-v1\.flac|audio\.mp3|publication-[a-f0-9-]{36}\.mp3)|samples\/[a-f0-9]+\.mp3)$/.test(key)) {
    throw new Error("Invalid chapter storage key.");
  }
}
export async function initializeChapterStorage() {
  await pool.query(`CREATE TABLE IF NOT EXISTS chapter_audio_files (
    file_key text PRIMARY KEY, item_id text NOT NULL, container_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
}
export async function chapterStorageConfigured(): Promise<boolean> {
  try {
    if (!readSpeGraphConfigFromEnv()) return false;
    await speFileStorage.resolveContainerId();
    return true;
  } catch { return false; }
}
async function findFile(key: string): Promise<ChapterFile | undefined> {
  validateKey(key);
  return (await pool.query<ChapterFile>("SELECT * FROM chapter_audio_files WHERE file_key=$1", [key])).rows[0];
}
export async function saveChapterFile(key: string, bytes: Buffer, contentType: string) {
  validateKey(key);
  // Unique upload paths avoid overwriting a live file if two workers race.
  const stored = await speFileStorage.storeFile({
    body: bytes, filename: key.split("/").at(-1)!, contentType,
    documentType: "chapter-audio", ownerId: randomUUID(),
  });
  const client = await pool.connect();
  let committed = false;
  let previous: ChapterFile | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
    previous = (await client.query<ChapterFile>("SELECT * FROM chapter_audio_files WHERE file_key=$1", [key])).rows[0];
    await client.query(`INSERT INTO chapter_audio_files(file_key,item_id,container_id) VALUES($1,$2,$3)
      ON CONFLICT(file_key) DO UPDATE SET item_id=excluded.item_id,container_id=excluded.container_id,created_at=now()`,
    [key, stored.itemId, stored.containerId]);
    await client.query("COMMIT");
    committed = true;
  } finally {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
      await speFileStorage.deleteFile(stored.itemId, stored.containerId).catch(() => {});
    }
    client.release();
  }
  // A failed superseded-file deletion is safely recoverable by SPE orphan
  // reconciliation; do not invalidate the successfully saved replacement.
  if (previous) await speFileStorage.deleteFile(previous.item_id, previous.container_id).catch(() => {});
}
export async function readChapterFile(key: string): Promise<Buffer> {
  const file = await findFile(key);
  if (!file) throw new Error("Chapter file is unavailable.");
  const response = await speFileStorage.getFile(file.item_id, file.container_id);
  if (!response.ok) throw new Error("SharePoint could not return the chapter file.");
  return Buffer.from(await response.arrayBuffer());
}
export async function readChapterAudioRange(key: string, start: number, end: number, size: number): Promise<Buffer> {
  const file = await findFile(key);
  if (!file) throw new Error("Chapter file is unavailable.");
  const response = await speFileStorage.getFile(file.item_id, file.container_id, `bytes=${start}-${end}`);
  if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${start}-${end}/${size}`) {
    await response.body?.cancel();
    throw new Error("SharePoint did not return the requested audio range.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== end - start + 1) throw new Error("Incomplete chapter audio range.");
  return bytes;
}
export async function chapterFileExists(key: string): Promise<boolean> {
  const file = await findFile(key);
  if (!file) return false;
  try { await speFileStorage.getMetadata(file.item_id, file.container_id); return true; }
  catch (error) {
    if (error instanceof SpeGraphRequestError && error.status === 404) return false;
    throw error;
  }
}
export async function deleteChapterFiles(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid chapter id.");
  const rows = (await pool.query<ChapterFile>("SELECT * FROM chapter_audio_files WHERE file_key LIKE $1", [`jobs/${id}/%`])).rows;
  for (const file of rows) {
    // An already deleted item is success. Keep the registry on other
    // failures so retention cleanup can retry safely.
    try { await speFileStorage.deleteFile(file.item_id, file.container_id); }
    catch (error) {
      if (!(error instanceof SpeGraphRequestError && error.status === 404)) throw error;
    }
    await pool.query("DELETE FROM chapter_audio_files WHERE file_key=$1 AND item_id=$2 AND container_id=$3",
      [file.file_key, file.item_id, file.container_id]);
  }
}
