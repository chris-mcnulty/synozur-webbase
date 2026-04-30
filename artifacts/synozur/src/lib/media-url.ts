/**
 * Shared media-URL plumbing.
 *
 * The api-server can resize storage-backed images on the fly (`?w=<n>`
 * on `/api/storage/objects/*` and `/api/storage/public-objects/*`).
 * Three places in the app need to (a) detect whether a URL is
 * resize-eligible, (b) append/replace the width parameter without
 * stomping on existing query/hash segments, and (c) normalize the
 * legacy `/objects/...` storage_key shape to its public path.
 *
 * Keep this file framework-free so admin editor pages, the asset
 * library, and the public insights helpers can share one source of
 * truth instead of drifting copies.
 */

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// URLs the api-server can resize on the fly (the storage routes that
// flow through sharp). External hosts and Vite-served `/images/...`
// paths are excluded — adding `?w=` to them would either be ignored
// or break caching.
export const RESIZABLE_PATH_RE = /\/api\/storage\/(?:public-)?objects\//i;

export function isResizableMediaUrl(url: string): boolean {
  return RESIZABLE_PATH_RE.test(url);
}

/**
 * Append/replace `?w=<width>` on a resolved URL the api-server can
 * resize. Non-resizable URLs (external hosts, static `/images/...`)
 * are returned unchanged so callers can use this on mixed sources.
 */
export function withWidth(
  resolvedUrl: string,
  width: number | undefined,
): string {
  if (!width || width <= 0) return resolvedUrl;
  if (!isResizableMediaUrl(resolvedUrl)) return resolvedUrl;
  const w = Math.max(1, Math.round(width));
  // Split off any existing query/hash so re-sizing an already-resolved
  // URL (one that already carries `?w=`) doesn't leave dangling
  // separators or duplicate parameters.
  const hashIdx = resolvedUrl.indexOf("#");
  const hash = hashIdx >= 0 ? resolvedUrl.slice(hashIdx) : "";
  const noHash = hashIdx >= 0 ? resolvedUrl.slice(0, hashIdx) : resolvedUrl;
  const qIdx = noHash.indexOf("?");
  const base = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const params = new URLSearchParams(qIdx >= 0 ? noHash.slice(qIdx + 1) : "");
  params.set("w", String(w));
  const qs = params.toString();
  return qs ? `${base}?${qs}${hash}` : `${base}${hash}`;
}

/**
 * Normalize a storage path to a fully-resolved URL the browser can
 * fetch.
 *
 * Handles three input shapes:
 *  - external `https://...` URLs are returned untouched
 *  - the legacy `/objects/...` storage_key shape is rewritten to
 *    `${BASE_PATH}/api/storage/objects/...` so `?w=` resizing applies
 *  - any other root-relative `/...` path (e.g. an already-resolved
 *    `/api/storage/...`, a static `/images/...`) gets `BASE_PATH`
 *    prepended
 */
export function resolveStoragePath(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/objects/")) return `${BASE_PATH}/api/storage${url}`;
  if (url.startsWith("/")) return `${BASE_PATH}${url}`;
  return url;
}
