import { objectStorageClient } from "../storage/gcsBackend";

// Separate from BOTH public search roots and /objects resolution. Generic
// public storage routes must never be able to resolve these private files.
function location() {
  const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucket) throw new Error("Private chapter storage is not configured.");
  const prefix = "synozur-private-chapter-audio/dev/";
  const path = `/${bucket}/${prefix}`.replace(/\/+$/, "");
  const roots = [
    ...(process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "").split(","),
    process.env.PRIVATE_OBJECT_DIR ?? "",
  ].map(p => p.trim().replace(/\/+$/, "")).filter(Boolean);
  if (roots.some(root => path === root || path.startsWith(`${root}/`))) {
    throw new Error("Chapter storage overlaps an existing file-serving root. A separate private namespace is required.");
  }
  return { bucket: objectStorageClient.bucket(bucket), prefix };
}

function object(key: string) {
  if (!/^(?:jobs\/[a-f0-9-]+\/(?:source\.txt|section-\d+\.mp3|audio\.mp3)|samples\/[a-f0-9]+\.mp3)$/.test(key)) {
    throw new Error("Invalid chapter storage key.");
  }
  const { bucket, prefix } = location();
  return bucket.file(`${prefix}${key}`);
}

export function chapterStorageConfigured(): boolean {
  try { location(); return true; } catch { return false; }
}
export async function saveChapterFile(key: string, bytes: Buffer, contentType: string) {
  await object(key).save(bytes, { resumable: false, metadata: { contentType, cacheControl: "private, no-store" } });
}
export async function readChapterFile(key: string): Promise<Buffer> {
  const [bytes] = await object(key).download();
  return bytes;
}
export async function chapterFileExists(key: string): Promise<boolean> {
  const [exists] = await object(key).exists();
  return exists;
}
export async function deleteChapterFiles(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid chapter id.");
  const { bucket, prefix } = location();
  await bucket.deleteFiles({ prefix: `${prefix}jobs/${id}/` });
}
