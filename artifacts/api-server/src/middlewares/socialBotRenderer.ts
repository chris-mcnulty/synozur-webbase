/**
 * Social-bot OG renderer middleware.
 *
 * Social link-preview crawlers (LinkedIn, Slack, Twitter/X, Facebook,
 * Discord, etc.) do not execute JavaScript, so they see the bare index.html
 * shell and cannot read OG tags written by the React app.
 *
 * When this middleware detects a social-category bot UA it:
 *  1. Looks up page-specific OG data from the DB via ogResolver.
 *  2. Returns a minimal HTML document with correct OG + Twitter Card tags.
 *  3. Adds a short Cache-Control header (5 min) to absorb repeated unfurls.
 *
 * All other requests (humans, search crawlers) pass straight through.
 */

import type { RequestHandler } from "express";
import { detectBot } from "../lib/traffic";
import { resolveOgData, renderOgHtml } from "../lib/ogResolver";

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

export function socialBotRendererMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET") return next();

    const url = req.url || "/";

    for (const prefix of SKIP_PREFIXES) {
      if (url === prefix || url.startsWith(prefix)) return next();
    }
    if (ASSET_EXT_RE.test(url)) return next();

    const ua = (req.headers["user-agent"] as string | undefined) ?? "";
    const bot = detectBot(ua);
    if (!bot.isBot || bot.category !== "social") return next();

    const pathname = url.split("?")[0] || "/";

    resolveOgData(pathname)
      .then((og) => {
        const html = renderOgHtml(og);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
        res.send(html);
      })
      .catch((err) => {
        req.log?.warn?.({ err }, "socialBotRenderer failed — falling through");
        next();
      });
  };
}
