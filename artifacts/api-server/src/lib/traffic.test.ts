/**
 * Unit tests for detectBot() in traffic.ts (#328).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:traffic-bot
 *
 * Covers every entry in BOT_SIGNATURES with one positive case (UA string
 * that contains the signature) and one negative case (a real browser UA).
 * This ensures a regex edit or list reorder can't silently break link
 * previews for any platform.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { detectBot } from "./traffic";

const HUMAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function isBot(ua: string, expectedName: string, expectedCategory: string): void {
  const r = detectBot(ua);
  assert.equal(r.isBot, true, `expected isBot=true for UA: ${ua}`);
  assert.equal(r.botName, expectedName, `expected botName="${expectedName}" for UA: ${ua}`);
  assert.equal(r.botCategory, expectedCategory, `expected botCategory="${expectedCategory}" for UA: ${ua}`);
}

function notBot(ua: string): void {
  const r = detectBot(ua);
  assert.equal(r.isBot, false, `expected isBot=false for UA: ${ua}`);
  assert.equal(r.botCategory, null);
  assert.equal(r.botName, null);
}

// ─── Null / empty ─────────────────────────────────────────────────────────────

test("detectBot: null UA → not a bot", () => notBot(null as unknown as string));
test("detectBot: empty string → not a bot", () => notBot(""));

// ─── Human UA never matches ───────────────────────────────────────────────────

test("detectBot: real Chrome UA → not a bot", () => notBot(HUMAN_UA));

// ─── AI crawlers ──────────────────────────────────────────────────────────────

test("detectBot: GPTBot → ai", () =>
  isBot("Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)", "GPTBot", "ai"));

test("detectBot: ChatGPT-User → ai", () =>
  isBot("Mozilla/5.0 ChatGPT-User/1.0", "ChatGPT-User", "ai"));

test("detectBot: OAI-SearchBot → ai", () =>
  isBot("OAI-SearchBot/1.0 (+https://openai.com/searchbot)", "OAI-SearchBot", "ai"));

test("detectBot: ClaudeBot → ai", () =>
  isBot("Mozilla/5.0 (compatible; ClaudeBot/1.0; +anthropic.com/en/aup)", "ClaudeBot", "ai"));

test("detectBot: Claude-Web → ai", () =>
  isBot("Claude-Web/1.0", "Claude-Web", "ai"));

test("detectBot: anthropic-ai → ai", () =>
  isBot("anthropic-ai/1.0", "anthropic-ai", "ai"));

test("detectBot: PerplexityBot → ai", () =>
  isBot("Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "PerplexityBot", "ai"));

test("detectBot: Perplexity-User → ai", () =>
  isBot("Perplexity-User/1.0", "Perplexity-User", "ai"));

test("detectBot: Google-Extended → ai", () =>
  isBot("Mozilla/5.0 (compatible; Google-Extended)", "Google-Extended", "ai"));

test("detectBot: Googlebot-News → search (before generic Googlebot)", () =>
  isBot("Mozilla/5.0 (compatible; Googlebot-News/2.1; +http://www.google.com/bot.html)", "Googlebot-News", "search"));

test("detectBot: GoogleOther → ai", () =>
  isBot("Mozilla/5.0 (Linux; Android 6.0.1) GoogleOther/1.0", "GoogleOther", "ai"));

test("detectBot: CCBot → ai", () =>
  isBot("CCBot/2.0 (https://commoncrawl.org/faq/)", "CCBot (CommonCrawl)", "ai"));

test("detectBot: Applebot-Extended → ai (before Applebot)", () =>
  isBot("Mozilla/5.0 (compatible; Applebot-Extended/0.1)", "Applebot-Extended", "ai"));

test("detectBot: Bytespider → ai", () =>
  isBot("Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 Bytespider/1.0", "Bytespider", "ai"));

test("detectBot: Amazonbot → ai", () =>
  isBot("Amazonbot/0.1 (+https://developer.amazon.com/support/amazonbot)", "Amazonbot", "ai"));

test("detectBot: Meta-ExternalAgent → ai", () =>
  isBot("Meta-ExternalAgent/1.0", "Meta-ExternalAgent", "ai"));

test("detectBot: Meta-ExternalFetcher → ai", () =>
  isBot("Meta-ExternalFetcher/1.0", "Meta-ExternalFetcher", "ai"));

test("detectBot: Cohere-ai → ai", () =>
  isBot("Cohere-ai/1.0", "Cohere-ai", "ai"));

test("detectBot: YouBot → ai", () =>
  isBot("Mozilla/5.0 (compatible; YouBot; +https://about.you.com/youbot/)", "YouBot", "ai"));

test("detectBot: DuckAssistBot → ai", () =>
  isBot("DuckAssistBot/1.0", "DuckAssistBot", "ai"));

test("detectBot: Diffbot → ai", () =>
  isBot("Diffbot/0.1 (+https://www.diffbot.com)", "Diffbot", "ai"));

test("detectBot: Ai2Bot-Dolma → ai (before plain Ai2Bot)", () =>
  isBot("Mozilla/5.0 (compatible; Ai2Bot-Dolma/1.0; +https://allenai.org/crawls)", "Ai2Bot-Dolma", "ai"));

test("detectBot: Ai2Bot → ai", () =>
  isBot("Mozilla/5.0 (compatible; Ai2Bot/1.0; +https://allenai.org/crawls)", "Ai2Bot", "ai"));

test("detectBot: iaskspider → ai", () =>
  isBot("iaskspider/1.0 (+https://iask.ai/)", "iaskspider", "ai"));

test("detectBot: MistralAI-User → ai", () =>
  isBot("MistralAI-User/1.0", "MistralAI-User", "ai"));

test("detectBot: Grok → ai", () =>
  isBot("Grok/1.0 (+https://x.ai/grok)", "Grok", "ai"));

// ─── Search crawlers ──────────────────────────────────────────────────────────

test("detectBot: Googlebot → search", () =>
  isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot", "search"));

test("detectBot: bingbot → search", () =>
  isBot("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "Bingbot", "search"));

test("detectBot: Applebot → search (after Applebot-Extended)", () =>
  isBot("Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)", "Applebot", "search"));

test("detectBot: DuckDuckBot → search", () =>
  isBot("DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)", "DuckDuckBot", "search"));

test("detectBot: YandexBot → search", () =>
  isBot("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)", "YandexBot", "search"));

test("detectBot: Baiduspider → search", () =>
  isBot("Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)", "Baiduspider", "search"));

test("detectBot: Sogou → search", () =>
  isBot("Sogou web spider/4.0", "Sogou", "search"));

test("detectBot: MJ12bot → search", () =>
  isBot("Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)", "MJ12bot", "search"));

test("detectBot: AhrefsBot → search", () =>
  isBot("Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", "AhrefsBot", "search"));

test("detectBot: SemrushBot → search", () =>
  isBot("Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)", "SemrushBot", "search"));

test("detectBot: DotBot → search", () =>
  isBot("Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)", "DotBot", "search"));

// ─── Social / link previewers ─────────────────────────────────────────────────

test("detectBot: facebookexternalhit → social", () =>
  isBot("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "facebookexternalhit", "social"));

test("detectBot: Twitterbot → social", () =>
  isBot("Twitterbot/1.0", "Twitterbot", "social"));

test("detectBot: LinkedInBot → social", () =>
  isBot("LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)", "LinkedInBot", "social"));

test("detectBot: Slackbot → social", () =>
  isBot("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Slackbot", "social"));

test("detectBot: Discordbot → social", () =>
  isBot("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "Discordbot", "social"));

test("detectBot: TelegramBot → social", () =>
  isBot("TelegramBot/1.0 (+https://core.telegram.org/bots/webhooks)", "TelegramBot", "social"));

test("detectBot: WhatsApp → social", () =>
  isBot("WhatsApp/2.23.8.0 A", "WhatsApp", "social"));

test("detectBot: SkypeUriPreview → social (MS Teams link previewer)", () =>
  isBot("Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5", "SkypeUriPreview", "social"));

test("detectBot: facebookcatalog → social", () =>
  isBot("facebookcatalog/1.0", "facebookcatalog", "social"));

test("detectBot: redditbot → social", () =>
  isBot("redditbot/1.0 (+https://www.redditinc.com/policies/privacy-policy)", "redditbot", "social"));

test("detectBot: Pinterest → social", () =>
  isBot("Pinterest/0.2 (+https://www.pinterest.com/bot.html)", "Pinterest", "social"));

// ─── Generic catch-all ────────────────────────────────────────────────────────

test("detectBot: bare 'bot' word → other", () =>
  isBot("SomeUnknownBot/1.0", "generic-bot", "other"));

test("detectBot: crawler → other", () =>
  isBot("MyCustomCrawler/2.0", "generic-bot", "other"));

test("detectBot: spider → other", () =>
  isBot("web-spider/1.0", "generic-bot", "other"));

test("detectBot: slurp → other", () =>
  isBot("Yahoo! Slurp/3.0", "generic-bot", "other"));

test("detectBot: curl/ → other", () =>
  isBot("curl/7.88.1", "generic-bot", "other"));

test("detectBot: wget/ → other", () =>
  isBot("Wget/1.21.3 (linux-gnu)", "generic-bot", "other"));

test("detectBot: python-requests → other", () =>
  isBot("python-requests/2.31.0", "generic-bot", "other"));

test("detectBot: HeadlessChrome → other", () =>
  isBot("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/114.0.5735.133 Safari/537.36", "generic-bot", "other"));

test("detectBot: python-httpx → other", () =>
  isBot("python-httpx/0.27.0", "generic-bot", "other"));

test("detectBot: aiohttp → other", () =>
  isBot("Python/3.11 aiohttp/3.9.1", "generic-bot", "other"));

test("detectBot: node-fetch → other", () =>
  isBot("node-fetch/1.0 (+https://github.com/node-fetch/node-fetch)", "generic-bot", "other"));

test("detectBot: go-http-client → other", () =>
  isBot("Go-http-client/2.0", "generic-bot", "other"));

test("detectBot: okhttp → other", () =>
  isBot("okhttp/4.12.0", "generic-bot", "other"));

test("detectBot: axios → other", () =>
  isBot("axios/1.6.0", "generic-bot", "other"));

// ─── Ordering: more-specific signatures win ───────────────────────────────────

test("detectBot: Googlebot-News beats generic Googlebot entry", () => {
  const r = detectBot("Googlebot-News/2.1");
  assert.equal(r.botName, "Googlebot-News");
  assert.equal(r.botCategory, "search");
});

test("detectBot: Applebot-Extended beats generic Applebot entry", () => {
  const r = detectBot("Applebot-Extended/0.1");
  assert.equal(r.botName, "Applebot-Extended");
  assert.equal(r.botCategory, "ai");
});

test("detectBot: Meta-ExternalFetcher beats generic Meta-ExternalAgent entry", () => {
  const r = detectBot("Meta-ExternalFetcher/1.0");
  assert.equal(r.botName, "Meta-ExternalFetcher");
});

test("detectBot: Ai2Bot-Dolma beats plain Ai2Bot entry", () => {
  const r = detectBot("Ai2Bot-Dolma/1.0");
  assert.equal(r.botName, "Ai2Bot-Dolma");
  assert.equal(r.botCategory, "ai");
});

// ─── Case-insensitivity ───────────────────────────────────────────────────────

test("detectBot: lowercase 'linkedinbot' still matches", () => {
  const r = detectBot("linkedinbot/1.0");
  assert.equal(r.isBot, true);
  assert.equal(r.botCategory, "social");
});

test("detectBot: all-caps 'TWITTERBOT' still matches", () => {
  const r = detectBot("TWITTERBOT/1.0");
  assert.equal(r.isBot, true);
  assert.equal(r.botCategory, "social");
});
