/**
 * Object-storage cache for dynamic OG images (#161).
 *
 * Cache key: `(kind, id, lastModifiedMs)` — embedding `lastModifiedMs`
 * means a row's `updated_at` bump naturally invalidates stale renders
 * without us having to delete bytes proactively. Old objects accumulate
 * but are dwarfed by the rest of the bucket; a periodic janitor can be
 * added later if it ever matters.
 *
 * Falls back to in-memory caching when `PRIVATE_OBJECT_DIR` isn't set
 * (dev environments without object storage configured), so the endpoint
 * still works in local development at the cost of process-local memory.
 */

import { objectStorageClient } from "./storage/gcsBackend";
import { logger } from "./logger";
import type { OgImageKind } from "./ogImageRenderer";

interface CacheKey {
  kind: OgImageKind;
  id: string;
  lastModifiedMs: number;
}

function objectName(key: CacheKey): string {
  return `og-cache/${key.kind}/${key.id}/${key.lastModifiedMs}.png`;
}

function parsePrivateBucket(): { bucketName: string; prefix: string } | null {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) return null;
  const path = dir.startsWith("/") ? dir : `/${dir}`;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 1) return null;
  const bucketName = parts[0]!;
  const prefix = parts.slice(1).join("/");
  return { bucketName, prefix };
}

// In-memory fallback. Capped to a small number of entries to bound RAM
// in dev. Most-recently-rendered wins.
const MEM_LIMIT = 32;
const memCache = new Map<string, Buffer>();

function memGet(key: string): Buffer | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  // LRU touch
  memCache.delete(key);
  memCache.set(key, hit);
  return hit;
}

function memSet(key: string, buf: Buffer): void {
  memCache.set(key, buf);
  while (memCache.size > MEM_LIMIT) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
}

export async function readCachedOgImage(key: CacheKey): Promise<Buffer | null> {
  const memKey = objectName(key);
  const mem = memGet(memKey);
  if (mem) return mem;

  const bucket = parsePrivateBucket();
  if (!bucket) return null;

  try {
    const fullName = bucket.prefix
      ? `${bucket.prefix}/${objectName(key)}`
      : objectName(key);
    const file = objectStorageClient.bucket(bucket.bucketName).file(fullName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    memSet(memKey, buf);
    return buf;
  } catch (err) {
    logger.warn({ err, key }, "ogImageCache read failed");
    return null;
  }
}

export async function writeCachedOgImage(
  key: CacheKey,
  buf: Buffer,
): Promise<void> {
  const memKey = objectName(key);
  memSet(memKey, buf);

  const bucket = parsePrivateBucket();
  if (!bucket) return;

  try {
    const fullName = bucket.prefix
      ? `${bucket.prefix}/${objectName(key)}`
      : objectName(key);
    const file = objectStorageClient.bucket(bucket.bucketName).file(fullName);
    await file.save(buf, {
      contentType: "image/png",
      metadata: { contentType: "image/png" },
      resumable: false,
    });
  } catch (err) {
    // Cache write failure is non-fatal — the byte response still goes
    // out, the next request just renders again.
    logger.warn({ err, key }, "ogImageCache write failed");
  }
}

/**
 * Drop every cached PNG for `(kind, id)` regardless of `lastModifiedMs`.
 *
 * Normal cache invalidation rides on the row's `updated_at` (the URL
 * carries `lastModifiedMs`, so a row bump produces a new URL and the
 * old object simply ages out). This helper covers the orthogonal case
 * where the *renderer template* has changed — same row, same
 * `updated_at`, but the bytes need to be re-rendered.
 *
 * Returns the count of objects (memory + storage combined) that were
 * dropped, primarily for log-line / API-response visibility.
 */
export async function clearCachedOgImage(
  kind: OgImageKind,
  id: string,
): Promise<number> {
  let cleared = 0;

  // In-memory: every entry whose object name starts with `og-cache/{kind}/{id}/`.
  const memPrefix = `og-cache/${kind}/${id}/`;
  for (const k of Array.from(memCache.keys())) {
    if (k.startsWith(memPrefix)) {
      memCache.delete(k);
      cleared++;
    }
  }

  const bucket = parsePrivateBucket();
  if (!bucket) return cleared;

  try {
    const fullPrefix = bucket.prefix
      ? `${bucket.prefix}/${memPrefix}`
      : memPrefix;
    const [files] = await objectStorageClient
      .bucket(bucket.bucketName)
      .getFiles({ prefix: fullPrefix });
    for (const file of files) {
      try {
        await file.delete({ ignoreNotFound: true });
        cleared++;
      } catch (err) {
        logger.warn({ err, name: file.name }, "ogImageCache clear: delete failed");
      }
    }
  } catch (err) {
    logger.warn({ err, kind, id }, "ogImageCache clear: list failed");
  }

  return cleared;
}
