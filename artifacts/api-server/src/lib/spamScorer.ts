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

async function checkAkismet(payload: CommentPayload): Promise<boolean | null> {
  const apiKey = process.env["AKISMET_API_KEY"];
  if (!apiKey) return null;
  try {
    const blog = process.env["SITE_URL"] ?? "https://www.synozur.com";
    const body = new URLSearchParams({
      blog,
      user_ip: payload.ip ?? "127.0.0.1",
      user_agent: payload.userAgent ?? "",
      comment_author: payload.authorName,
      comment_author_email: payload.authorEmail,
      comment_content: payload.bodyText,
      comment_type: "comment",
      ...(payload.postUrl ? { permalink: payload.postUrl } : {}),
    });
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
          },
          body: body.toString(),
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);
      const text = await res.text();
      if (text.trim() === "true") return true;
      if (text.trim() === "false") return false;
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
  if (akismetVerdict === true) {
    signals.push("akismet");
  }

  const isSpam = ruleIsSpam || akismetVerdict === true;
  return { isSpam, signals };
}
