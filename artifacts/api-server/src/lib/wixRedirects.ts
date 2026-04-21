import { eq, sql } from "drizzle-orm";
import { db, wixRedirectsTable, type WixRedirect } from "@workspace/db";
import { logger } from "./logger";

/**
 * In-memory cache of active Wix redirects keyed by normalized source path.
 * Re-hydrated on a TTL and invalidated whenever admin CRUD mutates the table.
 */
const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  targetPath: string;
  statusCode: number;
  id: string;
}

let cache: Map<string, CacheEntry> | null = null;
let cacheLoadedAt = 0;
let inflight: Promise<Map<string, CacheEntry>> | null = null;

export function normalizePath(raw: string): string {
  if (!raw) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const stripped = withSlash.replace(/\/+$/, "") || "/";
  return stripped.toLowerCase();
}

async function loadRedirects(): Promise<Map<string, CacheEntry>> {
  const rows = await db
    .select()
    .from(wixRedirectsTable)
    .where(eq(wixRedirectsTable.active, true));
  const map = new Map<string, CacheEntry>();
  for (const r of rows) {
    map.set(normalizePath(r.sourcePath), {
      targetPath: r.targetPath,
      statusCode: r.statusCode,
      id: r.id,
    });
  }
  return map;
}

async function getCache(): Promise<Map<string, CacheEntry>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = loadRedirects()
    .then((map) => {
      cache = map;
      cacheLoadedAt = Date.now();
      return map;
    })
    .catch((err) => {
      logger.error({ err }, "wix-redirects: failed to load");
      // Fall back to last-known cache, or an empty map.
      return cache ?? new Map();
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
  const map = await getCache();
  return map.get(normalizePath(path)) ?? null;
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
 */
export function wixRedirectMiddleware() {
  return async function (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) {
    // Only intercept GET/HEAD; leave everything else alone.
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const path = req.path || "/";
    // Never redirect API traffic.
    if (path.startsWith("/api/") || path === "/api") return next();
    try {
      const hit = await lookupRedirect(path);
      if (!hit) return next();
      // Don't redirect if the target is the same as the source (loop guard).
      if (normalizePath(hit.targetPath) === normalizePath(path)) return next();
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
