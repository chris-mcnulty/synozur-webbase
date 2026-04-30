import { useListInsights, useGetInsight } from "@workspace/api-client-react";
import type { ListInsightsParams } from "@workspace/api-client-react";
import { isResizableMediaUrl, resolveStoragePath, withWidth } from "@/lib/media-url";

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
  const resolved = resolveStoragePath(url);
  return withWidth(resolved, options?.width);
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
  const resolved = resolveStoragePath(url);
  if (!isResizableMediaUrl(resolved)) return null;
  const seen = new Set<number>();
  const parts: string[] = [];
  for (const w of widths) {
    const rounded = Math.max(1, Math.round(w));
    if (seen.has(rounded)) continue;
    seen.add(rounded);
    parts.push(`${withWidth(resolved, rounded)} ${rounded}w`);
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
