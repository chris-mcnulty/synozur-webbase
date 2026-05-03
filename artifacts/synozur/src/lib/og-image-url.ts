/**
 * Build the URL for the dynamic OG image endpoint (#161 / launch-readiness L14).
 *
 * The server-side endpoint at `GET /api/og/image?kind=&id=` renders a 1200×630
 * PNG fall-back when an editorial artifact has no editor-set `ogImage` /
 * `heroImage`. We embed the row's `updatedAt` (or `publishedAt`) epoch in the
 * `v=` query so social-crawler caches bust as soon as editorial saves a change.
 *
 * The returned URL is root-relative so `Meta` will resolve it against
 * `SITE_ORIGIN` for `og:image` (which must be absolute for crawlers).
 */
export type DynamicOgKind = "insight" | "case-study" | "white-paper" | "polaris";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

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
  return `${BASE_PATH}/api/og/image?kind=${kind}&id=${encodeURIComponent(id)}&v=${v}`;
}
