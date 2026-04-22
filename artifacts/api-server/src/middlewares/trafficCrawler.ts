import type { RequestHandler } from "express";
import { detectBot } from "../lib/traffic";
import { recordPageview } from "../routes/traffic";

/**
 * Records a pageview for bot/crawler GETs of HTML routes that wouldn't
 * otherwise trigger the client-side tracker. Real browsers report their
 * own pageviews via POST /api/traffic/collect; this middleware only fires
 * for user agents we've positively identified as bots so we don't
 * double-count humans.
 *
 * Intentionally non-blocking: failures are swallowed so tracking never
 * breaks page rendering.
 */
export function trafficCrawlerMiddleware(): RequestHandler {
  return (req, _res, next) => {
    if (req.method !== "GET") return next();

    const url = req.url || "/";
    // Skip API, proxy, feeds, static asset extensions, admin and auth routes.
    if (
      url.startsWith("/api/") ||
      url.startsWith("/__clerk") ||
      url.startsWith("/admin/") ||
      url === "/admin" ||
      url === "/sign-in" ||
      url.startsWith("/sign-in/") ||
      url === "/sign-up" ||
      url.startsWith("/sign-up/") ||
      url === "/sitemap.xml" ||
      url === "/robots.txt" ||
      url.startsWith("/polaris/rss.xml") ||
      /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|webm|pdf|xml|txt|json)(?:\?|$)/i.test(url)
    ) {
      return next();
    }

    const ua = (req.headers["user-agent"] as string | undefined) ?? "";
    const bot = detectBot(ua);
    if (!bot.isBot) return next();

    const pathname = url.split("?")[0] || "/";
    const referrer = (req.headers.referer as string | undefined) ?? null;
    let searchParams: URLSearchParams | null = null;
    try {
      searchParams = new URL(url, "http://local").searchParams;
    } catch {
      searchParams = null;
    }

    // Fire-and-forget — the request continues immediately.
    void recordPageview({
      req,
      pathname,
      title: null,
      referrer,
      queryString: searchParams,
    }).catch((err) => {
      req.log?.warn?.({ err }, "trafficCrawler record failed");
    });

    next();
  };
}
