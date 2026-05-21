/**
 * Integration tests for socialBotRendererMiddleware (#328).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:social-bot-renderer
 *
 * Covers:
 *   1. A social-category UA (LinkedIn, Slack, Facebook, Discord,
 *      Telegram, WhatsApp, SkypeUriPreview/Teams, Twitter/X) receives a
 *      minimal OG HTML document — not the React SPA shell.
 *   2. A regular human browser UA is passed through to the next handler
 *      (receives the React shell placeholder).
 *   3. An AI/search bot UA is also passed through — only "social"
 *      category bots are intercepted.
 *   4. POST requests are always passed through regardless of UA.
 *   5. Requests to skipped path prefixes (/api/, /admin, etc.) pass
 *      through regardless of UA.
 *   6. Requests for asset extensions (.js, .css, .png, …) pass through.
 *
 * The test spins up a minimal in-process Express server that mounts
 * only the middleware plus a catch-all that returns the string
 * "REACT_SHELL". This avoids a full app bootstrap while still
 * exercising the real `detectBot` + `resolveOgData` pipeline.
 * `resolveOgData` gracefully falls back to site defaults on DB errors,
 * so the test is self-contained.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { socialBotRendererMiddleware } from "./socialBotRenderer";

let server: http.Server;
let baseUrl: string;

const REACT_SHELL_MARKER = "REACT_SHELL";

test.before(async () => {
  const app = express();
  app.use(socialBotRendererMiddleware());
  app.use((_req, res) => res.status(200).send(REACT_SHELL_MARKER));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function getPage(path: string, ua: string, method = "GET"): Promise<{ status: number; body: string; contentType: string | null }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "User-Agent": ua },
  });
  const body = await res.text();
  return {
    status: res.status,
    body,
    contentType: res.headers.get("content-type"),
  };
}

const SOCIAL_UAS: Array<[string, string]> = [
  ["LinkedIn", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)"],
  ["Slack", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
  ["Facebook", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
  ["Discord", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
  ["Telegram", "TelegramBot/1.0 (+https://core.telegram.org/bots/webhooks)"],
  ["WhatsApp", "WhatsApp/2.23.8.0 A"],
  ["SkypeUriPreview (Teams)", "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5"],
  ["Twitter/X", "Twitterbot/1.0"],
];

const HUMAN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── Social bots receive OG HTML ──────────────────────────────────────────────

for (const [platform, ua] of SOCIAL_UAS) {
  test(`socialBotRenderer: ${platform} bot receives OG HTML (not React shell)`, async () => {
    const { status, body, contentType } = await getPage("/", ua);
    assert.equal(status, 200, `${platform}: expected 200`);
    assert.ok(
      contentType?.includes("text/html"),
      `${platform}: expected text/html, got ${contentType}`,
    );
    assert.ok(
      body.includes('<meta property="og:title"'),
      `${platform}: expected og:title meta tag in response`,
    );
    assert.ok(
      body.includes('<meta name="twitter:card"'),
      `${platform}: expected twitter:card meta tag in response`,
    );
    assert.ok(
      !body.includes(REACT_SHELL_MARKER),
      `${platform}: response should NOT contain the React shell marker`,
    );
  });
}

// ─── Cache-Control header ─────────────────────────────────────────────────────

test("socialBotRenderer: OG response includes Cache-Control header", async () => {
  const res = await fetch(`${baseUrl}/`, {
    headers: { "User-Agent": SOCIAL_UAS[0][1] },
  });
  const cc = res.headers.get("cache-control") ?? "";
  assert.ok(cc.includes("max-age="), `expected Cache-Control max-age, got: ${cc}`);
});

// ─── Human UA passes through ──────────────────────────────────────────────────

test("socialBotRenderer: human browser UA passes through to next handler", async () => {
  const { body } = await getPage("/", HUMAN_UA);
  assert.ok(
    body.includes(REACT_SHELL_MARKER),
    "human UA should reach the next handler (React shell)",
  );
});

// ─── AI/search bots pass through ─────────────────────────────────────────────

test("socialBotRenderer: Googlebot (search) passes through to next handler", async () => {
  const { body } = await getPage(
    "/",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  );
  assert.ok(
    body.includes(REACT_SHELL_MARKER),
    "Googlebot should not be intercepted by the social-bot middleware",
  );
});

test("socialBotRenderer: GPTBot (ai) passes through to next handler", async () => {
  const { body } = await getPage(
    "/",
    "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
  );
  assert.ok(
    body.includes(REACT_SHELL_MARKER),
    "GPTBot should not be intercepted by the social-bot middleware",
  );
});

// ─── POST requests always pass through ───────────────────────────────────────

test("socialBotRenderer: POST with social UA passes through to next handler", async () => {
  const { body } = await getPage("/", SOCIAL_UAS[0][1], "POST");
  assert.ok(body.includes(REACT_SHELL_MARKER), "POST should never be intercepted");
});

// ─── Skipped path prefixes ────────────────────────────────────────────────────

test("socialBotRenderer: /api/ path passes through for social UA", async () => {
  const { body } = await getPage("/api/healthz", SOCIAL_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), "/api/ should not be intercepted");
});

test("socialBotRenderer: /admin path passes through for social UA", async () => {
  const { body } = await getPage("/admin", SOCIAL_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), "/admin should not be intercepted");
});

// ─── Asset extensions pass through ───────────────────────────────────────────

test("socialBotRenderer: .js asset passes through for social UA", async () => {
  const { body } = await getPage("/assets/app.js", SOCIAL_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), ".js should not be intercepted");
});

test("socialBotRenderer: .png asset passes through for social UA", async () => {
  const { body } = await getPage("/opengraph.png", SOCIAL_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), ".png should not be intercepted");
});

// ─── Error-fallback path: resolver throws ─────────────────────────────────────

test("socialBotRenderer: renders site-level fallback OG HTML when resolver throws", async () => {
  // Spin up a separate app that uses a resolver that always rejects.
  const failingResolver = (_pathname: string): Promise<never> =>
    Promise.reject(new Error("simulated DB failure"));

  const app2 = express();
  app2.use(socialBotRendererMiddleware(failingResolver));
  app2.use((_req, res) => res.status(200).send(REACT_SHELL_MARKER));

  let server2: http.Server;
  let baseUrl2: string;

  await new Promise<void>((resolve) => {
    server2 = app2.listen(0, "127.0.0.1", () => resolve());
  });
  const addr2 = (server2!.address() as AddressInfo);
  baseUrl2 = `http://127.0.0.1:${addr2.port}`;

  try {
    const res = await fetch(`${baseUrl2}/insights/some-slug`, {
      headers: { "User-Agent": SOCIAL_UAS[0][1] },
    });
    const body = await res.text();
    const contentType = res.headers.get("content-type") ?? "";

    assert.equal(res.status, 200, "expected 200 even when resolver throws");
    assert.ok(
      contentType.includes("text/html"),
      `expected text/html on fallback, got: ${contentType}`,
    );
    assert.ok(
      body.includes('<meta property="og:title"'),
      "fallback response must contain og:title",
    );
    assert.ok(
      body.includes('<meta name="twitter:card"'),
      "fallback response must contain twitter:card",
    );
    assert.ok(
      !body.includes(REACT_SHELL_MARKER),
      "fallback must NOT fall through to the React shell",
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server2!.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
