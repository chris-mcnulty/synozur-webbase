import { useListInsights, useGetInsight } from "@workspace/api-client-react";
import type { ListInsightsParams } from "@workspace/api-client-react";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/**
 * Resolve a media path stored in the CMS (e.g. `/objects/uploads/<uuid>`)
 * to a URL the browser can fetch. App Storage object entities are served
 * by the api-server at `/api/storage/objects/<id>`.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/objects/")) {
    return `${BASE_PATH}/api/storage${url}`;
  }
  if (url.startsWith("/")) return `${BASE_PATH}${url}`;
  return url;
}

/** Rewrite `<img src="/objects/...">` inside body HTML to absolute api paths. */
export function resolveBodyHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(
    /(<img\b[^>]*\bsrc=)(["'])(\/objects\/[^"']+)\2/gi,
    (_m, prefix, quote, path) => `${prefix}${quote}${resolveMediaUrl(path)}${quote}`,
  );
}

export function useInsightsList(params?: ListInsightsParams) {
  return useListInsights(params);
}

export function useInsight(slug: string) {
  return useGetInsight(slug);
}
