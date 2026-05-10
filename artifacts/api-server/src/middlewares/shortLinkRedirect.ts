import { type Request, type Response, type NextFunction } from "express";
import {
  isShortLinkHost,
  lookupShortLink,
  recordClick,
} from "../lib/shortLinks";
import { logger } from "../lib/logger";

// Reserved first-segment paths that must never be treated as short-link
// slugs even when the request lands on `aka.synozur.com`. Keeps health
// probes, robots/sitemap, and accidental API traffic from being shadowed
// by a slug collision.
const RESERVED_FIRST_SEGMENTS = new Set<string>([
  "api",
  "health",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "llms.txt",
  ".well-known",
]);

function firstSegment(path: string): string | null {
  const trimmed = path.replace(/^\/+/, "");
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(0, slash);
}

// Express middleware — runs before any other routing. When the request lands
// on a configured short-link host (default `aka.synozur.com`), the first
// path segment is treated as a slug and 302 (or per-row code) redirected to
// the target URL. The original query string is preserved so trailing UTM
// params survive the bounce. On any other host the middleware is a no-op.
export function shortLinkRedirectMiddleware() {
  return async function (req: Request, res: Response, next: NextFunction) {
    if (!isShortLinkHost(req.hostname)) return next();

    // Root request on the redirect host — show a friendly page instead of
    // 404'ing. We delegate to whatever's downstream (probably the SPA
    // shell), but stamp a flag so a future handler can render a branded
    // landing if desired. Today this just falls through.
    const path = req.path || "/";
    if (path === "/" || path === "") return next();

    const seg = firstSegment(path);
    if (!seg) return next();
    if (RESERVED_FIRST_SEGMENTS.has(seg.toLowerCase())) return next();

    // Method preservation: 301/302 historically get rewritten to GET on
    // POST/PUT (RFC 7231 §6.4); we only fire those on safe methods. 307/308
    // are method-preserving so they fire on every method. Mirrors the
    // wixRedirects guard.
    try {
      const hit = await lookupShortLink(seg);
      if (!hit) return next();
      const safe = req.method === "GET" || req.method === "HEAD";
      const methodPreserving = hit.statusCode === 307 || hit.statusCode === 308;
      if (!safe && !methodPreserving) return next();

      const qs = req.originalUrl.includes("?")
        ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
        : "";

      // Fire-and-forget click recording so the redirect itself doesn't wait
      // on the audit insert. We capture the request context up front because
      // `req` properties (especially `ip`) are tied to the request lifetime.
      void recordClick(hit.id, {
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
        referrer: req.get("referer") ?? req.get("referrer") ?? null,
        country:
          (req.get("cf-ipcountry") || req.get("x-vercel-ip-country")) ?? null,
        sessionHash: null,
      });

      res.redirect(hit.statusCode, hit.targetUrl + qs);
    } catch (err) {
      logger.error({ err, path }, "short-links: middleware error");
      next();
    }
  };
}
