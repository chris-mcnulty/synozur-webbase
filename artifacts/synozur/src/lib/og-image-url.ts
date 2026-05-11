/**
 * Build the URL for the dynamic OG image endpoint (#161 / launch-readiness L14).
 *
 * The server-side endpoint at `GET /api/og/image?kind=&id=` renders a 1200×630
 * PNG fall-back when an editorial artifact has no editor-set `ogImage` /
 * `heroImage`. We embed two cache-busting params so upstream caches
 * (LinkedIn, Slack, browsers, CDNs that honour `Cache-Control: immutable`)
 * are forced to refetch when either signal changes:
 *   - `v` — the row's `updatedAt`/`publishedAt` epoch (per-row content bump).
 *   - `t` — the renderer template version (global template bump).
 *
 * Keep `OG_TEMPLATE_VERSION` in sync with
 * `artifacts/api-server/src/lib/ogImageRenderer.ts:OG_TEMPLATE_VERSION` —
 * bump both together on every visible template change so end-user caches
 * invalidate at the same time the server-side cache does.
 *
 * The returned URL is root-relative so `Meta` will resolve it against
 * `SITE_ORIGIN` for `og:image` (which must be absolute for crawlers).
 */
export type DynamicOgKind = "insight" | "case-study" | "white-paper" | "polaris" | "landing-page";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export const OG_TEMPLATE_VERSION = 2;

export function dynamicOgImageUrl(
  kind: DynamicOgKind,
  id: string | null | undefined,
  lastModified: string | Date | null | undefined,
): string | null {
  if (!id) return null;
  let v = 0;
  if (lastModified) {
    const d = lastModified instanceof Date ? lastModified : new Date(lastModified);
    if (!Number.isNaN(d.getTime())) v = d.getTime();
  }
  return `${BASE_PATH}/api/og/image?kind=${kind}&id=${encodeURIComponent(id)}&v=${v}&t=${OG_TEMPLATE_VERSION}`;
}
