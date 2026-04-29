// #127 Phase 3-C — short-lived cache that bridges the two-step upload flow.
//
// SPE has no presigned-URL equivalent of GCS, so the client can't PUT
// bytes directly to SharePoint. Instead, the SPE backend's
// `getObjectEntityUploadURL()` returns a URL that points back at our
// own api-server (`/api/storage/uploads/spe-direct/<token>`); the
// client PUTs the file there, the route streams the bytes through to
// SPE, and the resulting `speFileId` / `speContainerId` are stashed
// here keyed by the same `<token>`.
//
// `POST /cms/media` (called next by the upload-completion handler) then
// `consumes` the cache entry to populate the new media row's overlay
// columns. Single-use, 5-minute TTL, in-memory — the round-trip from
// client PUT to /cms/media POST happens within milliseconds in normal
// flows, so the cache is effectively transient bookkeeping.
//
// Failure mode if the entry is missed (process restart between PUT and
// /cms/media, TTL expiry, etc.): the media row gets created without
// `speFileId`, the read path falls back to GCS via `storage_key`, and
// we end up with an SPE orphan that the orphan-cleaner picks up later.
// Inconvenient but not data-losing.

interface SpeUploadCacheEntry {
  speFileId: string;
  speContainerId?: string;
  contentType: string;
  size: number;
  originalName?: string;
  stashedAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, SpeUploadCacheEntry>();

export function stashSpeUpload(
  token: string,
  entry: Omit<SpeUploadCacheEntry, "stashedAt">,
): void {
  cache.set(token, { ...entry, stashedAt: Date.now() });
}

export function consumeSpeUpload(
  token: string,
): SpeUploadCacheEntry | null {
  const entry = cache.get(token);
  if (!entry) return null;
  cache.delete(token);
  if (Date.now() - entry.stashedAt > TTL_MS) return null;
  return entry;
}

// Periodic GC. `unref()` so it doesn't keep the process alive when the
// server shuts down.
const interval = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) {
    if (now - v.stashedAt > TTL_MS) cache.delete(k);
  }
}, TTL_MS);
interval.unref?.();
