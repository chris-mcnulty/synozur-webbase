/**
 * Object-storage cache for dynamic OG images (#161).
 *
 * Cache key: `(kind, id, OG_TEMPLATE_VERSION, lastModifiedMs)`. Embedding
 * `lastModifiedMs` means a row's `updated_at` bump naturally invalidates
 * stale renders; embedding `OG_TEMPLATE_VERSION` means a renderer-template
 * change globally invalidates without touching every row. Old objects
 * accumulate but are dwarfed by the rest of the bucket; a periodic
 * janitor can be added later if it ever matters.
 *
 * Falls back to in-memory caching when `PRIVATE_OBJECT_DIR` isn't set
 * (dev environments without object storage configured), so the endpoint
 * still works in local development at the cost of process-local memory.
 */

import { objectStorageClient } from "./storage/gcsBackend";
import { logger } from "./logger";
import { OG_TEMPLATE_VERSION, type OgImageKind } from "./ogImageRenderer";

interface CacheKey {
  kind: OgImageKind;
  id: string;
  lastModifiedMs: number;
}

function objectName(key: CacheKey): string {
  return `og-cache/${key.kind}/${key.id}/v${OG_TEMPLATE_VERSION}-${key.lastModifiedMs}.png`;
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

/**
 * Outcome of a cache write. `ok=false` means the shared-storage save
 * failed; the in-memory copy may still be present, but other instances
 * won't see this entry. Callers that need a strong success signal (e.g.
 * the regenerate endpoint) should surface a 502 in that case.
 */
export interface CacheWriteResult {
  ok: boolean;
  storageConfigured: boolean;
  error?: string;
}

export async function writeCachedOgImage(
  key: CacheKey,
  buf: Buffer,
): Promise<CacheWriteResult> {
  const memKey = objectName(key);
  memSet(memKey, buf);

  const bucket = parsePrivateBucket();
  if (!bucket) return { ok: true, storageConfigured: false };

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
    return { ok: true, storageConfigured: true };
  } catch (err) {
    // Existing public GET path treats a write failure as non-fatal — the
    // byte response still goes out and the next request renders again.
    // Returning a structured result lets the regenerate endpoint surface
    // the failure instead of silently reporting success.
    logger.warn({ err, key }, "ogImageCache write failed");
    return {
      ok: false,
      storageConfigured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Outcome of a cache purge. `ok=false` means a list/delete operation
 * against shared storage failed; the in-memory cache is always purged
 * regardless. The regenerate endpoint promotes `ok=false` to a 502 so
 * operators don't get a false success signal in multi-instance deploys.
 */
export interface CacheClearResult {
  cleared: number;
  ok: boolean;
  storageConfigured: boolean;
  errors: string[];
}

/**
 * Drop every cached PNG for `(kind, id)` regardless of `lastModifiedMs`
 * or template version. Used by the admin regenerate endpoint when the
 * renderer template changes — same row, same `updated_at`, but the
 * bytes need to be re-rendered.
 */
export async function clearCachedOgImage(
  kind: OgImageKind,
  id: string,
): Promise<CacheClearResult> {
  let cleared = 0;
  const errors: string[] = [];

  // In-memory: every entry whose object name starts with `og-cache/{kind}/{id}/`.
  const memPrefix = `og-cache/${kind}/${id}/`;
  for (const k of Array.from(memCache.keys())) {
    if (k.startsWith(memPrefix)) {
      memCache.delete(k);
      cleared++;
    }
  }

  const bucket = parsePrivateBucket();
  if (!bucket) {
    return { cleared, ok: true, storageConfigured: false, errors };
  }

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
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`delete ${file.name}: ${msg}`);
        logger.warn({ err, name: file.name }, "ogImageCache clear: delete failed");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`list ${memPrefix}: ${msg}`);
    logger.warn({ err, kind, id }, "ogImageCache clear: list failed");
  }

  return {
    cleared,
    ok: errors.length === 0,
    storageConfigured: true,
    errors,
  };
}
