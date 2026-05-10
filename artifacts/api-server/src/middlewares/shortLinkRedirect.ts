import { type Request, type Response, type NextFunction } from "express";
import {
  getShortLinkSettings,
  isShortLinkHost,
  lookupShortLink,
  recordClick,
  renderShortLinkNotFoundHtml,
  renderShortLinkOgHtml,
} from "../lib/shortLinks";
import { detectBot } from "../lib/traffic";
import { logger } from "../lib/logger";

// First-segment paths that need their own response on the short-link host
// rather than being treated as a slug. Anything matching these is allowed
// to fall through to a downstream handler (e.g. the existing /robots.txt
// handler in `app.ts`); everything else either redirects (slug match) or
// renders our own 404 — the aka host never reveals the marketing SPA.
const PASSTHROUGH_FIRST_SEGMENTS = new Set<string>([
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  ".well-known",
]);

function firstSegment(path: string): string | null {
  const trimmed = path.replace(/^\/+/, "");
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(0, slash);
}

// Express middleware — runs before any other routing. When the request
// lands on a configured short-link host (default `aka.synozur.com`):
//   - GET/HEAD `/<slug>` → 302 to the slug's target (or per-row code).
//     If the requester is a known social-link-preview bot AND the slug
//     has any OG override fields set, render an HTML preview instead so
//     the unfurl shows curated copy.
//   - `/<unknown>` or `/` → 404 with the admin-configured fallback link.
//   - `/robots.txt`, `/.well-known`, etc. → fall through.
// On any other host the middleware short-circuits and is a no-op.
//
// The aka host NEVER falls through to `wixRedirectMiddleware`,
// `careersRedirectMiddleware`, or the SPA shell. Keeping the host
// surface minimal makes the redirect service independent of the
// marketing site's routing concerns.
export function shortLinkRedirectMiddleware() {
  return async function (req: Request, res: Response, next: NextFunction) {
    if (!(await isShortLinkHost(req.hostname))) return next();

    const path = req.path || "/";
    const seg = firstSegment(path);

    // Allow known site-root infrastructure paths to flow through to their
    // existing handlers (robots.txt, .well-known, IndexNow, etc.).
    if (seg && PASSTHROUGH_FIRST_SEGMENTS.has(seg.toLowerCase())) {
      return next();
    }

    // Root request on the redirect host — render the 404 page so the
    // marketing site never leaks through. The page itself surfaces the
    // admin-configured fallback URL when present.
    if (!seg) {
      try {
        const settings = await getShortLinkSettings();
        res.status(404);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.send(
          renderShortLinkNotFoundHtml({
            slug: "",
            fallbackUrl: settings.fallbackUrl,
            publicBase: settings.publicBase,
          }),
        );
      } catch (err) {
        logger.error({ err }, "short-links: 404 render failed");
        res.status(404).type("text/plain").send("Not found");
      }
      return;
    }

    try {
      const hit = await lookupShortLink(seg);
      if (!hit) {
        const settings = await getShortLinkSettings();
        res.status(404);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.send(
          renderShortLinkNotFoundHtml({
            slug: seg,
            fallbackUrl: settings.fallbackUrl,
            publicBase: settings.publicBase,
          }),
        );
        return;
      }

      // Method preservation: 301/302 historically get rewritten to GET on
      // POST/PUT (RFC 7231 §6.4); we only fire those on safe methods.
      // 307/308 are method-preserving so they fire on every method.
      const safe = req.method === "GET" || req.method === "HEAD";
      const methodPreserving = hit.statusCode === 307 || hit.statusCode === 308;
      if (!safe && !methodPreserving) {
        res.status(405).setHeader("Allow", "GET, HEAD").end();
        return;
      }

      const ua = req.get("user-agent") ?? "";
      const bot = detectBot(ua);
      const hasOgOverride =
        !!hit.ogTitle || !!hit.ogDescription || !!hit.ogImageUrl;

      // Social bot + OG override → serve preview HTML so the unfurl
      // shows the curated copy. Humans (and non-social bots) get the
      // redirect. Note: `botCategory` is the real property name on
      // detectBot's return; the existing socialBotRenderer reads
      // `bot.category` which appears to be a latent bug — we use the
      // documented field here to be safe.
      if (req.method === "GET" && bot.isBot && bot.botCategory === "social" && hasOgOverride) {
        const settings = await getShortLinkSettings();
        const title = hit.ogTitle || hit.title || `${settings.publicBase}/${seg}`;
        const description = hit.ogDescription || hit.targetUrl;
        res.status(200);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader(
          "Cache-Control",
          "public, max-age=300, s-maxage=300",
        );
        res.send(
          renderShortLinkOgHtml({
            url: `${settings.publicBase}/${seg}`,
            title,
            description,
            image: hit.ogImageUrl,
          }),
        );
        // Still log the click so unfurl-counts show up in stats.
        void recordClick(hit.id, {
          ip: req.ip ?? null,
          userAgent: ua,
          referrer: req.get("referer") ?? req.get("referrer") ?? null,
          country:
            (req.get("cf-ipcountry") || req.get("x-vercel-ip-country")) ??
            null,
          sessionHash: null,
        });
        return;
      }

      const qs = req.originalUrl.includes("?")
        ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
        : "";

      // Fire-and-forget click recording so the redirect itself doesn't
      // wait on the audit insert. Capture the request context up front
      // because `req` properties (especially `ip`) are tied to the
      // request lifetime.
      void recordClick(hit.id, {
        ip: req.ip ?? null,
        userAgent: ua,
        referrer: req.get("referer") ?? req.get("referrer") ?? null,
        country:
          (req.get("cf-ipcountry") || req.get("x-vercel-ip-country")) ?? null,
        sessionHash: null,
      });

      res.redirect(hit.statusCode, hit.targetUrl + qs);
    } catch (err) {
      logger.error({ err, path }, "short-links: middleware error");
      // On error, prefer a 502 over leaking through to the marketing site —
      // the aka host should remain isolated even when the redirect path
      // fails so monitoring catches the regression cleanly.
      res
        .status(502)
        .type("text/plain")
        .send("Short-link service is temporarily unavailable.");
    }
  };
}
