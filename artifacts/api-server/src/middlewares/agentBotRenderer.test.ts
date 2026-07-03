/**
 * Integration tests for agentBotRendererMiddleware.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:agent-bot-renderer
 *
 * Covers:
 *   1. Googlebot, GPTBot, and Bingbot UAs receive content-rich HTML (a real
 *      <h1>, not the bare React SPA shell).
 *   2. A real browser UA that sends Sec-Fetch-Mode passes through to next()
 *      (receives the SPA shell).
 *   3. A browser UA without Sec-Fetch-Mode on a known artifact path is also
 *      intercepted (generic HTTP fetcher path).
 *   4. A browser UA without Sec-Fetch-Mode on a NON-artifact path passes
 *      through (only DB-backed paths are intercepted for generic fetchers).
 *   5. A social-category bot (LinkedIn) passes through — only "ai" and
 *      "search" categories are intercepted here.
 *   6. POST requests always pass through regardless of UA.
 *   7. Skipped path prefixes (/api/, /admin, etc.) pass through regardless of UA.
 *   8. Requests for asset extensions (.js, .css, .png, …) pass through.
 *   9. Cache-Control is set on bot responses.
 *  10. When the htmlBuilder throws the middleware degrades to next() (SPA shell).
 *
 * The test injects a fake htmlBuilder so there is no DB dependency.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { agentBotRendererMiddleware } from "./agentBotRenderer";

const REACT_SHELL_MARKER = "REACT_SHELL";
const AGENT_H1 = "<h1>Welcome to The Synozur Alliance</h1>";
const FAKE_HTML = `<!DOCTYPE html><html><head><title>Test</title></head><body>${AGENT_H1}<p>Content for crawlers.</p></body></html>`;

function fakeBuilder(_pathname: string): Promise<string> {
  return Promise.resolve(FAKE_HTML);
}

function failingBuilder(_pathname: string): Promise<never> {
  return Promise.reject(new Error("simulated DB failure"));
}

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  const app = express();
  app.use(agentBotRendererMiddleware(fakeBuilder));
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

async function getPage(
  path: string,
  ua: string,
  opts: { method?: string; secFetchMode?: string } = {},
): Promise<{ status: number; body: string; contentType: string | null; cacheControl: string | null }> {
  const headers: Record<string, string> = { "User-Agent": ua };
  if (opts.secFetchMode !== undefined) {
    headers["Sec-Fetch-Mode"] = opts.secFetchMode;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
  });
  const body = await res.text();
  return {
    status: res.status,
    body,
    contentType: res.headers.get("content-type"),
    cacheControl: res.headers.get("cache-control"),
  };
}

/**
 * Make a raw HTTP/1.1 GET using node:http so no auto-headers (like
 * Sec-Fetch-Mode added by Node 24's built-in fetch) are injected.
 */
function getRawPage(
  rawBaseUrl: string,
  path: string,
  ua: string,
): Promise<{ status: number; body: string; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, rawBaseUrl);
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path: url.pathname + url.search, method: "GET", headers: { "User-Agent": ua } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
            headers: res.headers as Record<string, string | string[]>,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const HUMAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BOT_UAS: Array<[string, string]> = [
  [
    "Googlebot",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ],
  [
    "GPTBot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)",
  ],
  [
    "Bingbot",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  ],
  [
    "ClaudeBot",
    "Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com/bot)",
  ],
  [
    "PerplexityBot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  ],
];

// ─── AI / search bots receive content-rich HTML ───────────────────────────────

for (const [name, ua] of BOT_UAS) {
  test(`agentBotRenderer: ${name} receives content-rich HTML (not React shell)`, async () => {
    const { status, body, contentType } = await getPage("/", ua);
    assert.equal(status, 200, `${name}: expected 200`);
    assert.ok(
      contentType?.includes("text/html"),
      `${name}: expected text/html, got ${contentType}`,
    );
    assert.ok(
      body.includes("<h1>"),
      `${name}: expected a real <h1> in the response`,
    );
    assert.ok(
      body.includes(AGENT_H1),
      `${name}: expected the injected h1 content in the response`,
    );
    assert.ok(
      !body.includes(REACT_SHELL_MARKER),
      `${name}: response must NOT be the bare React shell`,
    );
  });
}

// ─── Cache-Control header is set on bot responses ─────────────────────────────

test("agentBotRenderer: response to bot includes Cache-Control header", async () => {
  const { cacheControl } = await getPage("/", BOT_UAS[0][1]);
  assert.ok(
    cacheControl?.includes("max-age="),
    `expected Cache-Control max-age, got: ${cacheControl}`,
  );
});

// ─── Real browser with Sec-Fetch-Mode passes through ─────────────────────────

test("agentBotRenderer: human browser UA with Sec-Fetch-Mode passes through to SPA shell", async () => {
  const { body } = await getPage("/", HUMAN_UA, { secFetchMode: "navigate" });
  assert.ok(
    body.includes(REACT_SHELL_MARKER),
    "browser with Sec-Fetch-Mode should reach the next handler (SPA shell)",
  );
});

// ─── Generic HTTP fetcher on artifact path is intercepted ────────────────────

test("agentBotRenderer: non-bot UA without Sec-Fetch-Mode on /insights/* is intercepted", async () => {
  // Use node:http directly so no Sec-Fetch-Mode auto-header is injected
  // (Node 24's built-in fetch adds it automatically, masking the behaviour).
  // No Sec-Fetch-Mode + no known bot UA = generic HTTP fetcher (curl/scraper/
  // AI agent with a custom UA) on a DB-backed artifact path → intercepted.
  const { body } = await getRawPage(baseUrl, "/insights/some-post", HUMAN_UA);
  assert.ok(
    body.includes("<h1>"),
    "generic fetcher on artifact path should receive content-rich HTML",
  );
  assert.ok(
    !body.includes(REACT_SHELL_MARKER),
    "generic fetcher on artifact path must NOT reach the SPA shell",
  );
});

// ─── Generic HTTP fetcher on NON-artifact path passes through ─────────────────

test("agentBotRenderer: non-bot UA without Sec-Fetch-Mode on /contact passes through", async () => {
  // /contact is a single-segment path → isArtifactPath returns false, so
  // generic fetchers still get the SPA shell even without Sec-Fetch-Mode.
  // Use node:http directly for the same reason as above.
  const { body } = await getRawPage(baseUrl, "/contact", HUMAN_UA);
  assert.ok(
    body.includes(REACT_SHELL_MARKER),
    "generic fetcher on non-artifact path should reach the SPA shell",
  );
});

// ─── Social-category bot passes through ──────────────────────────────────────

test("agentBotRenderer: LinkedIn social bot passes through to SPA shell", async () => {
  const linkedinUa =
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)";
  const { body } = await getPage("/", linkedinUa);
  assert.ok(
    body.includes(REACT_SHELL_MARKER),
    "social-category bot should NOT be intercepted by the agent-bot middleware",
  );
});

// ─── POST requests always pass through ───────────────────────────────────────

test("agentBotRenderer: POST with Googlebot UA passes through to next handler", async () => {
  const { body } = await getPage("/", BOT_UAS[0][1], { method: "POST" });
  assert.ok(body.includes(REACT_SHELL_MARKER), "POST should never be intercepted");
});

// ─── Skipped path prefixes ────────────────────────────────────────────────────

test("agentBotRenderer: /api/ path passes through for Googlebot", async () => {
  const { body } = await getPage("/api/healthz", BOT_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), "/api/ should not be intercepted");
});

test("agentBotRenderer: /admin path passes through for Googlebot", async () => {
  const { body } = await getPage("/admin", BOT_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), "/admin should not be intercepted");
});

test("agentBotRenderer: /sign-in path passes through for GPTBot", async () => {
  const { body } = await getPage("/sign-in", BOT_UAS[1][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), "/sign-in should not be intercepted");
});

// ─── Asset extensions pass through ───────────────────────────────────────────

test("agentBotRenderer: .js asset passes through for Googlebot", async () => {
  const { body } = await getPage("/assets/app.js", BOT_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), ".js should not be intercepted");
});

test("agentBotRenderer: .png asset passes through for GPTBot", async () => {
  const { body } = await getPage("/opengraph.png", BOT_UAS[1][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), ".png should not be intercepted");
});

test("agentBotRenderer: .xml asset passes through for Googlebot", async () => {
  const { body } = await getPage("/sitemap.xml", BOT_UAS[0][1]);
  assert.ok(body.includes(REACT_SHELL_MARKER), ".xml should not be intercepted");
});

// ─── Error degradation: htmlBuilder throws ────────────────────────────────────

test("agentBotRenderer: degrades to SPA shell when htmlBuilder throws", async () => {
  const app2 = express();
  app2.use(agentBotRendererMiddleware(failingBuilder));
  app2.use((_req, res) => res.status(200).send(REACT_SHELL_MARKER));

  let server2!: http.Server;
  await new Promise<void>((resolve) => {
    server2 = app2.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server2.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/insights/some-slug`, {
      headers: { "User-Agent": BOT_UAS[0][1] },
    });
    const body = await res.text();
    assert.ok(
      body.includes(REACT_SHELL_MARKER),
      "on htmlBuilder failure the middleware must degrade to next() (SPA shell)",
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server2.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
