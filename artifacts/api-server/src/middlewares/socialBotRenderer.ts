/**
 * Social-bot prerenderer middleware (secondary net).
 *
 * Social link-preview crawlers (LinkedIn, Slack, Twitter/X, Facebook,
 * Discord, Telegram, WhatsApp, Teams, etc.) cannot execute JavaScript, so
 * they see the bare index.html shell and miss the OG tags written by React.
 * This middleware intercepts those crawlers and serves a minimal
 * OG/Twitter-Card HTML document instead.
 *
 * AI agents and search-engine crawlers (Googlebot, GPTBot, etc.) are NOT
 * intercepted here — they are handled upstream by the synozur edge
 * (server.mjs in production) or the /api/seo/page route directly.
 *
 * Human browser navigations always pass straight through to next().
 *
 * The renderer adds a 5-min Cache-Control header. If the OG resolver throws
 * (DB down, etc.) the middleware degrades to site-level defaults rather than
 * falling through — so social crawlers always see a meaningful page.
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

    // Real browser navigations always carry Sec-Fetch-Mode; raw HTTP clients
    // (even ones spoofing a browser UA) almost never do. If detectBot says
    // this isn't a known bot BUT the header is present, it's a real browser —
    // let the SPA handle it. If the header is absent, fall through to the
    // prerender path so content-extraction crawlers see real page content
    // instead of the generic index.html shell.
    const secFetchMode = req.headers["sec-fetch-mode"] as string | undefined;
    if (!bot.isBot && secFetchMode) return next();

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

    // Only intercept social link-preview crawlers (LinkedIn, Slack, Twitter/X,
    // Facebook, Discord, etc.) with an OG/Twitter meta document. AI agents and
    // search-engine crawlers pass through — their content-rich rendering is
    // handled upstream (server.mjs edge in production, /api/seo/page in dev).
    if (bot.botCategory !== "social") return next();

    resolver(pathname)
      .then((og) => {
        const html = renderOgHtml(og);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
        res.send(html);
      })
      .catch(sendFallback);
  };
}
