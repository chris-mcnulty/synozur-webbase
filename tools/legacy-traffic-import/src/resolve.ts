import { db, wixRedirectsTable, postsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalizePath } from "./util";

const MAX_REDIRECT_DEPTH = 5;

/**
 * In-memory cache of `wix_redirects` and `posts.slug` so a 3,000-row import
 * doesn't issue 6,000 lookups. Loaded once per importer run.
 */
export interface ResolverCaches {
  redirects: Map<string, string>; // source_path → target_path (normalized)
  postSlugs: Set<string>;
}

export async function loadResolverCaches(): Promise<ResolverCaches> {
  const [redirectRows, postRows] = await Promise.all([
    db
      .select({
        sourcePath: wixRedirectsTable.sourcePath,
        targetPath: wixRedirectsTable.targetPath,
        active: wixRedirectsTable.active,
      })
      .from(wixRedirectsTable),
    db.select({ slug: postsTable.slug }).from(postsTable),
  ]);

  const redirects = new Map<string, string>();
  for (const r of redirectRows) {
    if (!r.active) continue;
    redirects.set(normalizePath(r.sourcePath), r.targetPath.trim());
  }

  const postSlugs = new Set<string>();
  for (const p of postRows) postSlugs.add(p.slug.toLowerCase());

  return { redirects, postSlugs };
}

export interface ResolutionResult {
  /** Final path on the new platform, or null if we couldn't resolve. */
  resolvedPath: string | null;
  /** Page type bucket suitable for `traffic_pageviews.page_type`. */
  pageType: string;
  /** Slug parsed out of the resolved path when it looks like a blog post. */
  postSlug: string | null;
  /** True when the lookup walked at least one wix_redirects entry. */
  redirected: boolean;
}

/**
 * Resolve a legacy path to its current new-platform equivalent. Walks
 * `wix_redirects` chains up to MAX_REDIRECT_DEPTH levels and detects cycles.
 * Returns `resolvedPath = null` if the input isn't recognized — the caller
 * decides whether to log it for triage.
 */
export function resolvePath(
  rawPath: string,
  caches: ResolverCaches,
): ResolutionResult {
  const start = normalizePath(rawPath);
  let current = start;
  let redirected = false;
  const seen = new Set<string>([current]);

  for (let i = 0; i < MAX_REDIRECT_DEPTH; i++) {
    const next = caches.redirects.get(current);
    if (!next) break;
    redirected = true;
    const normalizedNext = next.startsWith("http")
      ? next // external URL — stop here; we can't resolve further
      : normalizePath(next);
    if (seen.has(normalizedNext)) break; // cycle guard
    current = normalizedNext;
    seen.add(current);
    // External redirects (e.g. /s/foo.pdf → https://...) terminate the chain.
    if (current.startsWith("http")) break;
  }

  // External redirect: keep the original normalized legacy path so reporting
  // can still attribute pageviews, but mark it unresolved on the new site.
  if (current.startsWith("http")) {
    return {
      resolvedPath: null,
      pageType: "external",
      postSlug: null,
      redirected,
    };
  }

  const postSlug = postSlugFromPath(current, caches);
  return {
    resolvedPath: current,
    pageType: pageTypeOf(current),
    postSlug,
    redirected,
  };
}

function postSlugFromPath(path: string, caches: ResolverCaches): string | null {
  // The new platform serves blog posts at /post/<slug>; the legacy platform
  // used /insights/<slug> and /post/<slug>. The wix_redirects table already
  // rewrites the former to the latter, so by the time we see the path here
  // it should be /post/<slug> when it's a blog post.
  const m = path.match(/^\/post\/([a-z0-9-]+)$/);
  if (!m) return null;
  const slug = m[1]!;
  return caches.postSlugs.has(slug) ? slug : null;
}

function pageTypeOf(path: string): string {
  if (path === "/") return "home";
  if (path === "/insights") return "insights";
  if (path.startsWith("/insights/")) return "insight-detail";
  if (path.startsWith("/post/")) return "insight-detail";
  if (path.startsWith("/services-overview")) return "services-overview";
  if (path === "/services" || path.startsWith("/services/")) return "service-detail";
  if (path.startsWith("/solutions/")) return "solution-detail";
  if (path.startsWith("/case-studies")) return "case-study-detail";
  if (path.startsWith("/applications")) return "application-detail";
  if (path.startsWith("/models")) return "model-detail";
  if (path.startsWith("/workshops")) return "workshop-detail";
  if (path.startsWith("/webinars")) return "webinar-detail";
  if (path.startsWith("/videos")) return "video-detail";
  if (path.startsWith("/white-papers")) return "white-paper-detail";
  if (path.startsWith("/event-list") || path.startsWith("/events")) return "events";
  if (path === "/about") return "about";
  if (path === "/team") return "team";
  if (path === "/contact") return "contact";
  if (path === "/start") return "start";
  if (path === "/clients") return "clients";
  if (path === "/partners") return "partners";
  if (path === "/careers") return "careers";
  if (path === "/join") return "join";
  if (path === "/privacy" || path === "/terms") return "legal";
  return "other";
}
