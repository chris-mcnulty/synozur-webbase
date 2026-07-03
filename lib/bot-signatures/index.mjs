/**
 * Canonical agent-bot UA signatures — single source of truth for the monorepo.
 *
 * Consumed by:
 *   - artifacts/synozur/server.mjs                    (prerender routing)
 *   - artifacts/api-server/src/lib/traffic.ts         (bot analytics classification)
 *
 * Social / link-preview bots (LinkedIn, Slack, Twitter/X, Facebook, Discord…)
 * are intentionally NOT in this list. server.mjs and traffic.ts each handle
 * them separately: server.mjs routes social bots to the OG-tag path, while
 * traffic.ts classifies them as category "social" for analytics. The split is
 * deliberate and must stay that way.
 *
 * To add a new crawler UA: add one entry here. Both consumers update
 * automatically — no other file needs to change.
 *
 * Ordering rules (preserved across edits):
 *   1. Named AI/search patterns (most specific → least specific)
 *   2. GENERIC_FETCHER_SIGNATURES catch-alls (MUST stay last; a plain /\bbot\b/
 *      would swallow named patterns that appear after it)
 */

/**
 * Named AI-crawler and search-engine patterns.
 * traffic.ts inserts social-bot entries between this array and
 * GENERIC_FETCHER_SIGNATURES so social bots are classified correctly before
 * the broad catch-alls run.
 *
 * @type {ReadonlyArray<{match: RegExp, name: string, category: "ai"|"search"|"other"}>}
 */
export const SPECIFIC_AGENT_BOT_SIGNATURES = [
  // First-party crawlers — Orbit rotates real browser UAs; the Orbit/1.0
  // suffix token is the only reliable identifier (enable in Orbit settings).
  { match: /Orbit\//i, name: "Orbit", category: "other" },

  // AI assistants & crawlers
  { match: /GPTBot/i, name: "GPTBot", category: "ai" },
  { match: /ChatGPT-User/i, name: "ChatGPT-User", category: "ai" },
  { match: /OAI-SearchBot/i, name: "OAI-SearchBot", category: "ai" },
  { match: /ClaudeBot/i, name: "ClaudeBot", category: "ai" },
  { match: /Claude-Web/i, name: "Claude-Web", category: "ai" },
  { match: /anthropic-ai/i, name: "anthropic-ai", category: "ai" },
  { match: /PerplexityBot/i, name: "PerplexityBot", category: "ai" },
  { match: /Perplexity-User/i, name: "Perplexity-User", category: "ai" },
  { match: /Google-Extended/i, name: "Google-Extended", category: "ai" },
  // Googlebot-News must appear before plain Googlebot to be classified correctly
  { match: /Googlebot-News/i, name: "Googlebot-News", category: "search" },
  { match: /GoogleOther/i, name: "GoogleOther", category: "ai" },
  { match: /CCBot/i, name: "CCBot (CommonCrawl)", category: "ai" },
  // Applebot-Extended must appear before plain Applebot (search)
  { match: /Applebot-Extended/i, name: "Applebot-Extended", category: "ai" },
  { match: /Bytespider/i, name: "Bytespider", category: "ai" },
  { match: /Amazonbot/i, name: "Amazonbot", category: "ai" },
  { match: /Meta-ExternalAgent/i, name: "Meta-ExternalAgent", category: "ai" },
  { match: /Meta-ExternalFetcher/i, name: "Meta-ExternalFetcher", category: "ai" },
  { match: /cohere-ai/i, name: "Cohere-ai", category: "ai" },
  { match: /YouBot/i, name: "YouBot", category: "ai" },
  { match: /DuckAssistBot/i, name: "DuckAssistBot", category: "ai" },
  { match: /Diffbot/i, name: "Diffbot", category: "ai" },
  // Ai2Bot-Dolma must appear before plain Ai2Bot (Dolma is a training-data sub-crawler)
  { match: /Ai2Bot-Dolma/i, name: "Ai2Bot-Dolma", category: "ai" },
  { match: /Ai2Bot/i, name: "Ai2Bot", category: "ai" },
  { match: /iaskspider/i, name: "iaskspider", category: "ai" },
  { match: /MistralAI-User/i, name: "MistralAI-User", category: "ai" },
  { match: /\bGrok\b/i, name: "Grok", category: "ai" },

  // Search engines
  { match: /Googlebot/i, name: "Googlebot", category: "search" },
  { match: /bingbot/i, name: "Bingbot", category: "search" },
  { match: /Applebot/i, name: "Applebot", category: "search" },
  { match: /DuckDuckBot/i, name: "DuckDuckBot", category: "search" },
  { match: /YandexBot/i, name: "YandexBot", category: "search" },
  { match: /Baiduspider/i, name: "Baiduspider", category: "search" },
  { match: /Sogou/i, name: "Sogou", category: "search" },
  { match: /MJ12bot/i, name: "MJ12bot", category: "search" },
  { match: /AhrefsBot/i, name: "AhrefsBot", category: "search" },
  { match: /SemrushBot/i, name: "SemrushBot", category: "search" },
  { match: /DotBot/i, name: "DotBot", category: "search" },
];

/**
 * Broad catch-all patterns for generic non-JS HTTP fetchers (AI agents built
 * on HTTP libraries, headless automation, etc.).
 *
 * MUST come after all named patterns. Any new named bot should go in
 * SPECIFIC_AGENT_BOT_SIGNATURES above, not here.
 *
 * @type {ReadonlyArray<{match: RegExp, name: string, category: "other"}>}
 */
// All generic catch-all entries use name "generic-bot" to preserve the
// existing detectBot() contract (tests assert botName === "generic-bot" for
// these patterns). Individual libraries (curl, wget, etc.) are matched by
// distinct regexes but presented under the same generic label.
export const GENERIC_FETCHER_SIGNATURES = [
  { match: /bot\b/i, name: "generic-bot", category: "other" },
  { match: /crawler/i, name: "generic-bot", category: "other" },
  { match: /spider/i, name: "generic-bot", category: "other" },
  { match: /slurp/i, name: "generic-bot", category: "other" },
  { match: /curl\//i, name: "generic-bot", category: "other" },
  { match: /wget\//i, name: "generic-bot", category: "other" },
  { match: /python-requests/i, name: "generic-bot", category: "other" },
  { match: /python-httpx/i, name: "generic-bot", category: "other" },
  { match: /aiohttp/i, name: "generic-bot", category: "other" },
  { match: /node-fetch/i, name: "generic-bot", category: "other" },
  { match: /\bgo-http-client\b/i, name: "generic-bot", category: "other" },
  { match: /\bokhttp\b/i, name: "generic-bot", category: "other" },
  { match: /\baxios\b/i, name: "generic-bot", category: "other" },
  { match: /HeadlessChrome/i, name: "generic-bot", category: "other" },
];

/**
 * Combined array of all agent-bot signatures (specific + generic).
 * Used by server.mjs for prerender routing. traffic.ts uses the split exports
 * directly so it can interleave social-bot entries before the catch-alls.
 *
 * @type {ReadonlyArray<{match: RegExp, name: string, category: "ai"|"search"|"other"}>}
 */
export const AGENT_BOT_SIGNATURES = [
  ...SPECIFIC_AGENT_BOT_SIGNATURES,
  ...GENERIC_FETCHER_SIGNATURES,
];
