/**
 * Agent / search-bot prerenderer middleware (secondary net for dev + direct hits).
 *
 * In production, the synozur edge (server.mjs) intercepts AI agents and
 * search-engine crawlers before they reach this server and proxies them to
 * GET /api/seo/page.  In development — and for any request that bypasses the
 * edge — Googlebot, GPTBot, Bingbot, etc. arrive here directly and would
 * otherwise receive the bare SPA shell from spaFallbackMiddleware.
 *
 * This middleware is the secondary net: it detects "ai" and "search" bot
 * categories (plus generic non-JS HTTP fetchers that lack Sec-Fetch-Mode on
 * DB-backed artifact paths) and serves the content-rich document produced by
 * buildAgentPageHtml.
 *
 * Social link-preview crawlers are NOT intercepted here — they are handled
 * upstream by socialBotRendererMiddleware, which serves a leaner OG/Twitter
 * meta document instead.
 *
 * Human browser navigations always pass straight through to next().
 *
 * Cache-Control is set to 5 minutes (same as socialBotRendererMiddleware).
 * On any renderer error the middleware degrades to next() so the SPA shell
 * is still served rather than a 500.
 */

import type { RequestHandler } from "express";
import { detectBot } from "../lib/traffic";
import { buildAgentPageHtml } from "../lib/agentRenderer";
import { isArtifactPath } from "../lib/routeStatus";

// Paths that should never be intercepted by this middleware.
const SKIP_PREFIXES = [
  "/api/",
  "/admin",
  "/sign-in",
  "/sign-up",
  "/__",
];

// Exact paths within otherwise-renderable sections that must never be
// intercepted (e.g. the Polaris podcast RSS feed is XML, not an HTML page).
const SKIP_EXACT = new Set(["/polaris/rss.xml"]);

// File extensions that are never HTML pages.
const ASSET_EXT_RE =
  /\.(?:js|mjs|ts|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|webm|pdf|xml|txt|json)(?:\?|$)/i;

export function agentBotRendererMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET") return next();

    const url = req.url || "/";

    for (const prefix of SKIP_PREFIXES) {
      if (url === prefix || url.startsWith(prefix)) return next();
    }
    const pathname = url.split("?")[0] || "/";
    if (SKIP_EXACT.has(pathname)) return next();
    if (ASSET_EXT_RE.test(url)) return next();

    const ua = (req.headers["user-agent"] as string | undefined) ?? "";
    const bot = detectBot(ua);

    // Intercept known AI-agent and search-engine crawlers.
    const isAgentCategory =
      bot.botCategory === "ai" || bot.botCategory === "search";

    // Also intercept generic HTTP fetchers on DB-backed artifact paths: a
    // request with no Sec-Fetch-Mode and no known bot UA is almost certainly
    // a raw HTTP client (curl, scraper, AI agent with a custom UA, etc.)
    // rather than a real browser. Modern browsers always send Sec-Fetch-Mode
    // on top-level navigations (Chrome 76+, Firefox 90+, Edge 79+, Safari 16.4+).
    const secFetchMode = req.headers["sec-fetch-mode"] as string | undefined;
    const isGenericFetcher =
      !bot.isBot && !secFetchMode && isArtifactPath(pathname);

    if (!isAgentCategory && !isGenericFetcher) return next();

    buildAgentPageHtml(pathname)
      .then((html) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
        res.send(html);
      })
      .catch((err: unknown) => {
        req.log?.warn?.(
          { err },
          "agentBotRenderer: buildAgentPageHtml failed — passing through to SPA fallback",
        );
        next();
      });
  };
}
