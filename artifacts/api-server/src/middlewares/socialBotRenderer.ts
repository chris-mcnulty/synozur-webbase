/**
 * Bot prerenderer middleware (secondary net).
 *
 * Crawlers that do not execute JavaScript see the bare index.html shell and
 * cannot read content/OG tags written by the React app. This middleware
 * serves them server-rendered HTML instead, branching by bot category:
 *
 *  - social link-preview crawlers (LinkedIn, Slack, Twitter/X, Facebook,
 *    Discord, etc.) → minimal OG/Twitter-Card document via renderOgHtml.
 *  - AI agents, search engines, and other non-JS fetchers → a content-rich
 *    document (real body sourced from the DB) via buildAgentPageHtml.
 *
 * Both branches add a short Cache-Control header (5 min). If a renderer
 * throws (DB down, schema mismatch, etc.) the middleware degrades to the
 * site-level OG defaults rather than falling through to next() — so bots
 * always see a meaningful page.
 *
 * Note: in production the synozur edge (server.mjs) owns page paths and
 * proxies bots to /api/og or /api/seo/page directly; this middleware is the
 * secondary net for requests that reach the API server directly. Human
 * requests always pass straight through.
 */

import type { RequestHandler } from "express";
import { detectBot } from "../lib/traffic";
import {
  resolveOgData,
  renderOgHtml,
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  type OgData,
} from "../lib/ogResolver";
import { buildAgentPageHtml } from "../lib/agentRenderer";
import { siteOrigin } from "../lib/siteOrigin";

// Paths that should never be intercepted by this middleware.
const SKIP_PREFIXES = [
  "/api/",
  "/admin",
  "/sign-in",
  "/sign-up",
  "/__",
  "/polaris/",
];

// File extensions that are never HTML pages.
const ASSET_EXT_RE =
  /\.(?:js|mjs|ts|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|webm|pdf|xml|txt|json)(?:\?|$)/i;

export function socialBotRendererMiddleware(
  resolver: (pathname: string) => Promise<OgData> = resolveOgData,
  pageBuilder: (pathname: string) => Promise<string> = buildAgentPageHtml,
): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET") return next();

    const url = req.url || "/";

    for (const prefix of SKIP_PREFIXES) {
      if (url === prefix || url.startsWith(prefix)) return next();
    }
    if (ASSET_EXT_RE.test(url)) return next();

    const ua = (req.headers["user-agent"] as string | undefined) ?? "";
    const bot = detectBot(ua);
    if (!bot.isBot) return next();

    const pathname = url.split("?")[0] || "/";

    const sendFallback = (err: unknown) => {
      req.log?.warn?.(
        { err },
        "socialBotRenderer: renderer failed — serving site-level fallback",
      );
      const origin = siteOrigin();
      const fallback: OgData = {
        title: SITE_NAME,
        description: DEFAULT_DESCRIPTION,
        image: `${origin}/opengraph.jpg`,
        ogType: "website",
        url: `${origin}${pathname}`,
      };
      const html = renderOgHtml(fallback);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
      res.send(html);
    };

    // Social link-preview crawlers only need OG/Twitter meta. AI agents,
    // search engines, and other non-JS fetchers get the content-rich body.
    if (bot.botCategory === "social") {
      resolver(pathname)
        .then((og) => {
          const html = renderOgHtml(og);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
          res.send(html);
        })
        .catch(sendFallback);
      return;
    }

    pageBuilder(pathname)
      .then((html) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
        res.send(html);
      })
      .catch(sendFallback);
  };
}
