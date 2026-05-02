import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const SETTINGS_ID = 1;

const DEFAULT_LINK_THRESHOLD = 3;
const DEFAULT_KEYWORDS: string[] = [
  "buy cheap",
  "click here",
  "earn money fast",
  "free viagra",
  "free cialis",
  "online casino",
  "make money online",
  "weight loss",
  "work from home",
  "seo services",
];
const DEFAULT_DOMAIN_BLOCKLIST: string[] = [
  "mailinator.com",
  "guerrillamail.com",
  "trashmail.com",
  "tempmail.com",
  "yopmail.com",
  "sharklasers.com",
];

const URL_PATTERN = /https?:\/\/[^\s<>"]+|www\.[^\s<>"]+/gi;
const NAME_URL_PATTERN = /https?:\/\/|www\./i;
const AKISMET_TIMEOUT_MS = 5000;

export interface SpamVerdict {
  isSpam: boolean;
  signals: string[];
}

export interface CommentPayload {
  authorName: string;
  authorEmail: string;
  bodyText: string;
  ip: string | null;
  userAgent: string | null;
  postUrl?: string;
}

let rulesCache: SpamRules | null = null;
let rulesCacheAt = 0;
const RULES_CACHE_TTL_MS = 60_000;

interface SpamRules {
  linkThreshold: number;
  keywords: string[];
  domainBlocklist: string[];
}

async function loadRules(): Promise<SpamRules> {
  const now = Date.now();
  if (rulesCache && now - rulesCacheAt < RULES_CACHE_TTL_MS) return rulesCache;
  try {
    const [row] = await db
      .select({
        spamLinkThreshold: siteSettingsTable.spamLinkThreshold,
        spamKeywords: siteSettingsTable.spamKeywords,
        spamDomainBlocklist: siteSettingsTable.spamDomainBlocklist,
      })
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, SETTINGS_ID));
    rulesCache = {
      linkThreshold: row?.spamLinkThreshold ?? DEFAULT_LINK_THRESHOLD,
      keywords: row?.spamKeywords ?? DEFAULT_KEYWORDS,
      domainBlocklist: row?.spamDomainBlocklist ?? DEFAULT_DOMAIN_BLOCKLIST,
    };
    rulesCacheAt = now;
  } catch (err) {
    logger.warn({ err }, "spamScorer: failed to load rules from DB, using defaults");
    rulesCache = {
      linkThreshold: DEFAULT_LINK_THRESHOLD,
      keywords: DEFAULT_KEYWORDS,
      domainBlocklist: DEFAULT_DOMAIN_BLOCKLIST,
    };
    rulesCacheAt = now;
  }
  return rulesCache;
}

export function invalidateSpamRulesCache(): void {
  rulesCache = null;
  rulesCacheAt = 0;
}

function countLinks(text: string): number {
  const matches = text.match(URL_PATTERN);
  return matches ? matches.length : 0;
}

function checkKeywords(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return kw;
    }
  }
  return null;
}

interface AkismetResult {
  isSpam: boolean;
  discard: boolean;
}

async function checkAkismet(payload: CommentPayload): Promise<AkismetResult | null> {
  const apiKey = process.env["AKISMET_API_KEY"];
  if (!apiKey) return null;
  try {
    const blog = process.env["SITE_URL"] ?? "https://www.synozur.com";
    const params: Record<string, string> = {
      blog,
      user_ip: payload.ip ?? "127.0.0.1",
      user_agent: payload.userAgent ?? "",
      comment_author: payload.authorName,
      comment_author_email: payload.authorEmail,
      comment_content: payload.bodyText,
      comment_type: "comment",
    };
    if (payload.postUrl) params["permalink"] = payload.postUrl;
    // Opt-in test mode for environments doing integration testing — Akismet
    // will not learn from these submissions when `is_test=1`.
    if (process.env["AKISMET_TEST"] === "1") params["is_test"] = "1";
    const body = new URLSearchParams(params);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AKISMET_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://${encodeURIComponent(apiKey)}.rest.akismet.com/1.1/comment-check`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "SynozurCMS/1.0 | Akismet/1.0",
            // Ask Akismet to include a debug-help header on `invalid` responses
            // so we can surface the reason in our logs without leaking it to
            // end users.
            "Akismet-DEBUG-Help": "1",
          },
          body: body.toString(),
          signal: controller.signal,
        },
      );
      const text = (await res.text()).trim();
      const proTip = res.headers.get("x-akismet-pro-tip") ?? "";
      const debugHelp = res.headers.get("x-akismet-debug-help") ?? "";
      if (text === "true") {
        return { isSpam: true, discard: proTip === "discard" };
      }
      if (text === "false") {
        return { isSpam: false, discard: false };
      }
      // Akismet returns the literal string "invalid" when the API key (or
      // another required field) is rejected. Surface the debug header so the
      // operator can fix the misconfiguration.
      if (text === "invalid") {
        logger.warn(
          { debugHelp },
          "Akismet rejected request as invalid; falling back to rule-based scorer",
        );
        return null;
      }
      logger.warn({ response: text }, "Akismet returned unexpected response");
      return null;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.warn({ err }, "Akismet check failed, falling back to rule-based scorer");
    return null;
  }
}

/**
 * Validate an Akismet API key against the verify-key endpoint. Returns true
 * when Akismet replies with "valid". Used at server startup to log a clear
 * warning if the configured key is wrong, and exposed for ad-hoc checks.
 */
export async function verifyAkismetKey(): Promise<boolean | null> {
  const apiKey = process.env["AKISMET_API_KEY"];
  if (!apiKey) return null;
  const blog = process.env["SITE_URL"] ?? "https://www.synozur.com";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AKISMET_TIMEOUT_MS);
  try {
    const res = await fetch("https://rest.akismet.com/1.1/verify-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "SynozurCMS/1.0 | Akismet/1.0",
      },
      body: new URLSearchParams({ key: apiKey, blog }).toString(),
      signal: controller.signal,
    });
    const text = (await res.text()).trim();
    if (text === "valid") return true;
    const debugHelp = res.headers.get("x-akismet-debug-help") ?? "";
    logger.warn({ response: text, debugHelp }, "Akismet verify-key did not return 'valid'");
    return false;
  } catch (err) {
    logger.warn({ err }, "Akismet verify-key request failed");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function scoreComment(payload: CommentPayload): Promise<SpamVerdict> {
  const rules = await loadRules();
  const signals: string[] = [];

  const linkCount = countLinks(payload.bodyText);
  if (linkCount > rules.linkThreshold) {
    signals.push(`excessive-links:${linkCount}`);
  }

  const hitKeyword = checkKeywords(payload.bodyText, rules.keywords);
  if (hitKeyword) {
    signals.push(`keyword:${hitKeyword}`);
  }

  if (NAME_URL_PATTERN.test(payload.authorName)) {
    signals.push("url-in-author-name");
  }

  if (payload.authorEmail) {
    const domain = payload.authorEmail.split("@")[1]?.toLowerCase();
    if (domain && rules.domainBlocklist.some((d) => d.toLowerCase() === domain)) {
      signals.push(`blocked-email-domain:${domain}`);
    }
  }

  const ruleIsSpam = signals.length > 0;

  const akismetVerdict = await checkAkismet(payload);
  if (akismetVerdict?.isSpam) {
    signals.push("akismet");
    if (akismetVerdict.discard) {
      // Akismet's "discard" pro-tip means the comment is so blatantly spam
      // it's safe to drop without admin review. We still file it under spam
      // so admins can audit, but tag it so the UI can surface that hint.
      signals.push("akismet-discard");
    }
  }

  const isSpam = ruleIsSpam || akismetVerdict?.isSpam === true;
  return { isSpam, signals };
}
