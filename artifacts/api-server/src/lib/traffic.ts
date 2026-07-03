import crypto from "node:crypto";
import type { Request } from "express";
import {
  SPECIFIC_AGENT_BOT_SIGNATURES,
  GENERIC_FETCHER_SIGNATURES,
} from "@workspace/bot-signatures";

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot";
export type BotCategory = "ai" | "search" | "social" | "other";
export type TrafficSource =
  | "direct"
  | "organic"
  | "ai"
  | "referral"
  | "social"
  | "paid"
  | "internal";

export interface UaFacts {
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  deviceType: DeviceType;
  isBot: boolean;
  botCategory: BotCategory | null;
  botName: string | null;
}

// Named agent-bot and generic-fetcher patterns are sourced from the shared
// @workspace/bot-signatures package (lib/bot-signatures/index.mjs) — that is
// the single source of truth for the monorepo. Social / link-preview bots are
// intentionally kept inline here because server.mjs routes them to the OG-tag
// path rather than prerendering, so they must not appear in the shared list.
//
// Ordering: named AI/search (from shared) → social (inline) → generic catch-alls (from shared).
// Social bots must come before the generic catch-alls because several social
// UA strings contain "bot" (e.g. Slackbot) and would be mis-classified if the
// catch-all ran first.

// Social / link previewers — traffic.ts only, not shared with server.mjs.
const SOCIAL_BOT_SIGNATURES: Array<{ match: RegExp; name: string; category: "social" }> = [
  { match: /facebookexternalhit/i, name: "facebookexternalhit", category: "social" },
  { match: /facebookcatalog/i, name: "facebookcatalog", category: "social" },
  { match: /Twitterbot/i, name: "Twitterbot", category: "social" },
  { match: /LinkedInBot/i, name: "LinkedInBot", category: "social" },
  { match: /Slackbot/i, name: "Slackbot", category: "social" },
  { match: /Discordbot/i, name: "Discordbot", category: "social" },
  { match: /TelegramBot/i, name: "TelegramBot", category: "social" },
  { match: /WhatsApp/i, name: "WhatsApp", category: "social" },
  { match: /SkypeUriPreview/i, name: "SkypeUriPreview", category: "social" },
  { match: /Pinterest/i, name: "Pinterest", category: "social" },
  { match: /redditbot/i, name: "redditbot", category: "social" },
];

const BOT_SIGNATURES: Array<{
  match: RegExp;
  name: string;
  category: BotCategory;
}> = [
  ...SPECIFIC_AGENT_BOT_SIGNATURES,
  ...SOCIAL_BOT_SIGNATURES,
  ...GENERIC_FETCHER_SIGNATURES,
];

export function detectBot(ua: string | null | undefined): {
  isBot: boolean;
  botCategory: BotCategory | null;
  botName: string | null;
} {
  if (!ua) return { isBot: false, botCategory: null, botName: null };
  for (const sig of BOT_SIGNATURES) {
    if (sig.match.test(ua)) {
      return { isBot: true, botCategory: sig.category, botName: sig.name };
    }
  }
  return { isBot: false, botCategory: null, botName: null };
}

/**
 * Minimal User-Agent parser. We don't need the full UA database — we bucket
 * into a fixed set of browsers, OSes, and device types that drive the admin
 * breakdowns. Extends naturally: add a new regex branch when a bucket matters.
 */
export function parseUa(ua: string | null | undefined): UaFacts {
  const bot = detectBot(ua);
  if (!ua) {
    return {
      browserName: null,
      browserVersion: null,
      osName: null,
      deviceType: bot.isBot ? "bot" : "desktop",
      isBot: bot.isBot,
      botCategory: bot.botCategory,
      botName: bot.botName,
    };
  }

  // Browser (order matters — Edge/Brave/Opera spoof Chrome, so they go first).
  let browserName: string | null = null;
  let browserVersion: string | null = null;
  const browsers: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Brave\/([\d.]+)/, "Brave"],
    [/Vivaldi\/([\d.]+)/, "Vivaldi"],
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
    [/MSIE ([\d.]+)|Trident.*rv:([\d.]+)/, "Internet Explorer"],
  ];
  for (const [re, name] of browsers) {
    const m = ua.match(re);
    if (m) {
      browserName = name;
      browserVersion = (m[1] ?? m[2] ?? null)?.split(".").slice(0, 2).join(".") ?? null;
      break;
    }
  }

  // OS
  let osName: string | null = null;
  if (/Windows NT 10/.test(ua)) osName = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(ua)) osName = "Windows 8.1";
  else if (/Windows NT 6\.[12]/.test(ua)) osName = "Windows 7/8";
  else if (/Windows/.test(ua)) osName = "Windows";
  else if (/iPhone OS|iOS/.test(ua)) osName = "iOS";
  else if (/iPad/.test(ua)) osName = "iPadOS";
  else if (/Mac OS X/.test(ua)) osName = "macOS";
  else if (/Android/.test(ua)) osName = "Android";
  else if (/CrOS/.test(ua)) osName = "ChromeOS";
  else if (/Linux/.test(ua)) osName = "Linux";

  // Device type
  let deviceType: DeviceType;
  if (bot.isBot) {
    deviceType = "bot";
  } else if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) {
    deviceType = "tablet";
  } else if (/Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|Opera Mini|IEMobile/.test(ua)) {
    deviceType = "mobile";
  } else {
    deviceType = "desktop";
  }

  return {
    browserName,
    browserVersion,
    osName,
    deviceType,
    isBot: bot.isBot,
    botCategory: bot.botCategory,
    botName: bot.botName,
  };
}

const AI_REFERRER_HOSTS = new Set([
  "chat.openai.com",
  "chatgpt.com",
  "www.chatgpt.com",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "www.perplexity.ai",
  "you.com",
  "www.you.com",
  "poe.com",
  "www.poe.com",
]);

const SEARCH_REFERRER_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "www.bing.com",
  "bing.com",
  "duckduckgo.com",
  "www.duckduckgo.com",
  "search.brave.com",
  "www.ecosia.org",
  "ecosia.org",
  "search.yahoo.com",
  "yandex.com",
  "yandex.ru",
  "baidu.com",
]);

const SOCIAL_REFERRER_HOSTS = new Set([
  "t.co",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "lnkd.in",
  "linkedin.com",
  "www.linkedin.com",
  "l.facebook.com",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "reddit.com",
  "www.reddit.com",
  "out.reddit.com",
  "news.ycombinator.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "threads.net",
  "www.threads.net",
  "bsky.app",
  "mastodon.social",
]);

export interface SourceClassification {
  source: TrafficSource;
  referrerHost: string | null;
  referrerUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

export function classifySource(input: {
  referrerUrl: string | null;
  selfHost: string | null;
  landingQuery: URLSearchParams | null;
  isBotCategory: BotCategory | null;
}): SourceClassification {
  const { referrerUrl, selfHost, landingQuery, isBotCategory } = input;

  let referrerHost: string | null = null;
  let isInternal = false;
  if (referrerUrl) {
    try {
      const u = new URL(referrerUrl);
      referrerHost = u.hostname.toLowerCase();
      if (selfHost && referrerHost === selfHost.toLowerCase()) {
        isInternal = true;
      }
    } catch {
      referrerHost = null;
    }
  }

  const utmSource = landingQuery?.get("utm_source")?.slice(0, 120) ?? null;
  const utmMedium = landingQuery?.get("utm_medium")?.slice(0, 120) ?? null;
  const utmCampaign = landingQuery?.get("utm_campaign")?.slice(0, 120) ?? null;
  const utmTerm = landingQuery?.get("utm_term")?.slice(0, 120) ?? null;
  const utmContent = landingQuery?.get("utm_content")?.slice(0, 120) ?? null;

  let source: TrafficSource;
  if (utmMedium) {
    const med = utmMedium.toLowerCase();
    if (med.includes("cpc") || med.includes("paid") || med.includes("ppc") || med === "display") {
      source = "paid";
    } else if (med.includes("social")) {
      source = "social";
    } else if (med.includes("organic")) {
      source = "organic";
    } else if (med === "email" || med === "newsletter") {
      source = "referral";
    } else {
      source = "referral";
    }
  } else if (utmSource) {
    // utm_source without a medium — a tagged link still beats the referrer guess.
    source = "referral";
  } else if (isBotCategory === "ai") {
    source = "ai";
  } else if (isInternal) {
    source = "internal";
  } else if (!referrerHost) {
    source = "direct";
  } else if (AI_REFERRER_HOSTS.has(referrerHost)) {
    source = "ai";
  } else if (SEARCH_REFERRER_HOSTS.has(referrerHost)) {
    source = "organic";
  } else if (SOCIAL_REFERRER_HOSTS.has(referrerHost)) {
    source = "social";
  } else {
    source = "referral";
  }

  return {
    source,
    referrerHost: isInternal ? null : referrerHost,
    referrerUrl: isInternal ? null : referrerUrl,
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
  };
}

/**
 * Map a URL path to a coarse page type used for admin segmentation.
 * Prefer stable, human-readable buckets over raw paths.
 */
export function classifyPageType(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  if (p === "/insights") return "insights";
  if (p.startsWith("/insights/")) return "insight-detail";
  if (p.startsWith("/services-overview")) return "services-overview";
  if (p.startsWith("/services/")) return "service-detail";
  if (p.startsWith("/solutions/")) return "solution-detail";
  if (p === "/case-studies") return "case-studies";
  if (p.startsWith("/case-studies/")) return "case-study-detail";
  if (p === "/applications") return "applications";
  if (p.startsWith("/applications/")) return "application-detail";
  if (p === "/models") return "models";
  if (p.startsWith("/models/")) return "model-detail";
  if (p === "/workshops") return "workshops";
  if (p.startsWith("/workshops/")) return "workshop-detail";
  if (p === "/library") return "library";
  if (p.startsWith("/library/")) return "library-detail";
  if (p === "/webinars") return "webinars";
  if (p.startsWith("/webinars/")) return "webinar-detail";
  if (p === "/videos") return "videos";
  if (p.startsWith("/videos/")) return "video-detail";
  if (p === "/white-papers") return "white-papers";
  if (p.startsWith("/white-papers/")) return "white-paper-detail";
  if (p === "/events") return "events";
  if (p.startsWith("/events/")) return "event-detail";
  if (p === "/polaris") return "polaris";
  if (p === "/contact") return "contact";
  if (p === "/start") return "start";
  if (p === "/about") return "about";
  if (p === "/clients") return "clients";
  if (p === "/partners") return "partners";
  if (p === "/team") return "team";
  if (p === "/faq") return "faq";
  if (p === "/privacy" || p === "/terms") return "legal";
  if (p.startsWith("/admin")) return "admin";
  return "other";
}

export function clientIpFromRequest(req: Request): string {
  const xff = Array.isArray(req.headers["x-forwarded-for"])
    ? (req.headers["x-forwarded-for"] as string[])[0]
    : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff || req.ip || "0.0.0.0";
}

export function countryFromRequest(req: Request): {
  country: string | null;
  region: string | null;
  city: string | null;
} {
  const h = req.headers;
  const first = (v: unknown): string | null => {
    if (Array.isArray(v)) return v[0] ?? null;
    if (typeof v === "string" && v.length > 0) return v;
    return null;
  };
  const country =
    first(h["cf-ipcountry"]) ||
    first(h["x-vercel-ip-country"]) ||
    first(h["x-country-code"]) ||
    first(h["fastly-country-code"]) ||
    null;
  const region =
    first(h["cf-region-code"]) || first(h["x-vercel-ip-country-region"]) || null;
  const city = first(h["x-vercel-ip-city"]) || first(h["cf-ipcity"]) || null;
  return {
    country: country?.toUpperCase().slice(0, 2) ?? null,
    region: region?.slice(0, 64) ?? null,
    city: city ? decodeURIComponent(city).slice(0, 120) : null,
  };
}

/**
 * Session key. Combines IP + UA + a daily bucket so a visitor collapses to
 * one row per day. Narrower than GA's 30-min window, wider than a per-request
 * fingerprint — it matches what we actually need for the admin dashboards
 * (daily unique visitors, traffic sources at first touch).
 */
export function sessionKey(ip: string, ua: string, dayBucket: string): string {
  return crypto
    .createHash("sha256")
    .update(`${ip}|${ua}|${dayBucket}`)
    .digest("hex")
    .slice(0, 48);
}

export function ipHash(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export function todayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export function hostFromReferrer(
  ref: string | null | undefined,
  selfHost: string | null,
): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    const h = u.hostname.toLowerCase();
    if (selfHost && h === selfHost.toLowerCase()) return null;
    return h;
  } catch {
    return null;
  }
}
