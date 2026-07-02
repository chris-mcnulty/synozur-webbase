import { eq, sql } from "drizzle-orm";
import { db, wixRedirectsTable, type WixRedirect } from "@workspace/db";
import { logger } from "./logger";

/**
 * In-memory cache of active Wix redirects.
 *
 * Two structures are maintained:
 *   exact    — keyed by normalized source path for O(1) lookups.
 *   prefixes — ordered list of wildcard prefix rules (source ends with "/*").
 *              Checked only when the exact map produces no match. The first
 *              matching prefix wins (DB insertion order, then alphabetical).
 *
 * Cache is re-hydrated on a 60-second TTL and invalidated whenever admin
 * CRUD mutates the table.
 */
const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  targetPath: string;
  statusCode: number;
  id: string;
}

interface PrefixPattern {
  /** Normalized path prefix, e.g. "/post/" */
  prefix: string;
  /** Target template, may contain "*" which is replaced with the captured suffix. */
  targetTemplate: string;
  statusCode: number;
  id: string;
}

interface RedirectCache {
  exact: Map<string, CacheEntry>;
  prefixes: PrefixPattern[];
}

let cache: RedirectCache | null = null;
let cacheLoadedAt = 0;
let inflight: Promise<RedirectCache> | null = null;

export function normalizePath(raw: string): string {
  if (!raw) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const stripped = withSlash.replace(/\/+$/, "") || "/";
  return stripped.toLowerCase();
}

async function loadRedirects(): Promise<RedirectCache> {
  const rows = await db
    .select()
    .from(wixRedirectsTable)
    .where(eq(wixRedirectsTable.active, true));

  const exact = new Map<string, CacheEntry>();
  const prefixes: PrefixPattern[] = [];

  for (const r of rows) {
    const normalized = normalizePath(r.sourcePath);
    if (normalized.endsWith("/*")) {
      // Wildcard prefix rule: "/post/*" → prefix="/post/"
      prefixes.push({
        prefix: normalized.slice(0, -1), // strip the trailing "*", keep "/"
        targetTemplate: r.targetPath,
        statusCode: r.statusCode,
        id: r.id,
      });
    } else {
      exact.set(normalized, {
        targetPath: r.targetPath,
        statusCode: r.statusCode,
        id: r.id,
      });
    }
  }

  return { exact, prefixes };
}

async function getCache(): Promise<RedirectCache> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = loadRedirects()
    .then((result) => {
      cache = result;
      cacheLoadedAt = Date.now();
      return result;
    })
    .catch((err) => {
      logger.error({ err }, "wix-redirects: failed to load");
      return cache ?? { exact: new Map(), prefixes: [] };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateRedirectCache(): void {
  cache = null;
  cacheLoadedAt = 0;
}

export async function lookupRedirect(path: string): Promise<CacheEntry | null> {
  const { exact, prefixes } = await getCache();
  const normalized = normalizePath(path);

  // Exact match has priority over wildcards.
  const hit = exact.get(normalized);
  if (hit) return hit;

  // Prefix-wildcard match: first matching rule wins.
  // Source "/post/*" matches any path starting with "/post/".
  // The captured suffix replaces "*" in the target template.
  for (const p of prefixes) {
    if (normalized.startsWith(p.prefix)) {
      const suffix = normalized.slice(p.prefix.length);
      const targetPath = p.targetTemplate.includes("*")
        ? p.targetTemplate.replace("*", suffix)
        : p.targetTemplate;
      return { targetPath, statusCode: p.statusCode, id: p.id };
    }
  }

  return null;
}

export async function recordHit(id: string): Promise<void> {
  try {
    await db
      .update(wixRedirectsTable)
      .set({ hitCount: sql`${wixRedirectsTable.hitCount} + 1`, lastHitAt: new Date() })
      .where(eq(wixRedirectsTable.id, id));
  } catch (err) {
    logger.warn({ err, id }, "wix-redirects: failed to record hit");
  }
}

/**
 * Express middleware that checks the incoming request path against the Wix
 * redirect table and 301s (or 302, per row) when a match is found. Query
 * string is preserved.
 *
 * Wildcard prefix rules (source path ending in "/*") are supported:
 *   /post/*  →  /insights/*   captures and rewrites the slug.
 */
export function wixRedirectMiddleware() {
  return async function (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) {
    const path = req.path || "/";
    // Never redirect API traffic.
    if (path.startsWith("/api/") || path === "/api") return next();
    try {
      const hit = await lookupRedirect(path);
      if (!hit) return next();
      // Don't redirect if the target is the same as the source (loop guard).
      if (normalizePath(hit.targetPath) === normalizePath(path)) return next();
      // 301/302 are method-rewriting per RFC 7231; honouring them on a
      // POST/PUT/etc. would silently drop the request body. Skip those
      // cases so the original request reaches its handler. 307/308 are
      // method- and body-preserving (RFC 7231 §6.4.7 / RFC 7538), so they
      // *do* fire on every method — this is the L13 fix that lets editors
      // migrate POST endpoints from Wix without losing the body.
      const safe = req.method === "GET" || req.method === "HEAD";
      const methodPreserving = hit.statusCode === 307 || hit.statusCode === 308;
      if (!safe && !methodPreserving) return next();
      // Fire-and-forget hit counter so redirect latency stays minimal.
      void recordHit(hit.id);
      const qs = req.originalUrl.includes("?")
        ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
        : "";
      const location = hit.targetPath + qs;
      res.redirect(hit.statusCode, location);
    } catch (err) {
      logger.error({ err, path }, "wix-redirects: middleware error");
      next();
    }
  };
}

export type WixRedirectEntry = WixRedirect;
