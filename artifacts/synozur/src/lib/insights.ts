import { useListInsights, useGetInsight } from "@workspace/api-client-react";
import type { ListInsightsParams } from "@workspace/api-client-react";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Matches URLs the api-server can resize on the fly (the storage routes that
// flow through sharp). External hosts and Vite-served `/images/...` paths are
// excluded — adding `?w=` to them would either be ignored or break caching.
const RESIZABLE_PATH_RE = /\/api\/storage\/(?:public-)?objects\//i;

function isResizableMediaUrl(url: string): boolean {
  return RESIZABLE_PATH_RE.test(url);
}

function appendWidthQuery(resolvedUrl: string, width: number): string {
  if (!isResizableMediaUrl(resolvedUrl)) return resolvedUrl;
  const w = Math.max(1, Math.round(width));
  // Split off any existing query/hash so re-sizing an already-resolved URL
  // (e.g. one that already carries `?w=`) doesn't leave dangling separators.
  const hashIdx = resolvedUrl.indexOf("#");
  const hash = hashIdx >= 0 ? resolvedUrl.slice(hashIdx) : "";
  const noHash = hashIdx >= 0 ? resolvedUrl.slice(0, hashIdx) : resolvedUrl;
  const qIdx = noHash.indexOf("?");
  const base = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const search = qIdx >= 0 ? noHash.slice(qIdx + 1) : "";
  const params = new URLSearchParams(search);
  params.set("w", String(w));
  const qs = params.toString();
  return qs ? `${base}?${qs}${hash}` : `${base}${hash}`;
}

function toAbsolutePath(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/objects/")) return `${BASE_PATH}/api/storage${url}`;
  if (url.startsWith("/")) return `${BASE_PATH}${url}`;
  return url;
}

export interface ResolveMediaOptions {
  /** Request a server-resized variant. Ignored for non-resizable paths. */
  width?: number;
}

/**
 * Resolve a media path stored in the CMS (e.g. `/objects/uploads/<uuid>`)
 * to a URL the browser can fetch. App Storage object entities are served
 * by the api-server at `/api/storage/objects/<id>`.
 *
 * Pass `{ width }` to request a sharp-resized WebP variant from the
 * api-server. Non-resizable paths (external hosts, static `/images/...`)
 * are returned without the query parameter.
 */
export function resolveMediaUrl(
  url: string | null | undefined,
  options?: ResolveMediaOptions,
): string | null {
  if (!url) return null;
  const resolved = toAbsolutePath(url);
  if (options?.width && options.width > 0) {
    return appendWidthQuery(resolved, options.width);
  }
  return resolved;
}

/**
 * Build a `srcset` string with multiple width variants for responsive
 * `<img>` tags. Returns null for URLs the api-server cannot resize so
 * callers can drop the `srcset` attribute entirely.
 */
export function buildMediaSrcSet(
  url: string | null | undefined,
  widths: readonly number[],
): string | null {
  if (!url || widths.length === 0) return null;
  const resolved = toAbsolutePath(url);
  if (!isResizableMediaUrl(resolved)) return null;
  const seen = new Set<number>();
  const parts: string[] = [];
  for (const w of widths) {
    const rounded = Math.max(1, Math.round(w));
    if (seen.has(rounded)) continue;
    seen.add(rounded);
    parts.push(`${appendWidthQuery(resolved, rounded)} ${rounded}w`);
  }
  return parts.join(", ");
}

// Default size for inline body images. Post bodies render inside a
// max-w-3xl prose column (≈768px CSS), so 1024 covers typical 2x DPR.
const BODY_IMAGE_DEFAULT_WIDTH = 1024;

/** Rewrite `<img src="/objects/...">` inside body HTML to absolute api paths. */
export function resolveBodyHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\bsrc=(["'])(\/objects\/[^"']+)\1/i);
    if (!srcMatch) return tag;
    const quote = srcMatch[1];
    const path = srcMatch[2];
    const sizedSrc = resolveMediaUrl(path, { width: BODY_IMAGE_DEFAULT_WIDTH });
    if (!sizedSrc) return tag;
    let next = tag.replace(
      /\bsrc=(["'])\/objects\/[^"']+\1/i,
      `src=${quote}${sizedSrc}${quote}`,
    );
    if (!/\bloading=/i.test(next)) {
      next = next.replace(/<img\b/i, `<img loading="lazy"`);
    }
    if (!/\bdecoding=/i.test(next)) {
      next = next.replace(/<img\b/i, `<img decoding="async"`);
    }
    return next;
  });
}

export function useInsightsList(params?: ListInsightsParams) {
  return useListInsights(params);
}

export function useInsight(slug: string) {
  return useGetInsight(slug);
}
