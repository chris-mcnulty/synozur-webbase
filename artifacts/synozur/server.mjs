/**
 * Production server for The Synozur Alliance SPA.
 *
 * Serves the pre-built Vite output from dist/public/ and intercepts
 * social-bot link-preview crawlers so they receive server-rendered OG tags
 * instead of the bare JS shell.
 *
 * Architecture:
 *  - Social bots (LinkedIn, Slack, Twitter/X, Facebook, Discord…):
 *      Proxied to GET /api/og?path=<pathname> on the API server.
 *      The API server resolves DB content and returns minimal OG HTML.
 *  - Everything else:
 *      Served as static files.  Unknown paths fall through to index.html
 *      (SPA client-side routing).
 *
 * Every HTML response also carries:
 *  - `<meta name="google-site-verification">` and `<meta name="msvalidate.01">`
 *    spliced in from env vars so search-console verification crawlers (which
 *    don't run JS) can confirm ownership (#160 / launch readiness L2).
 *  - The same security header set helmet applies to the API server in
 *    artifacts/api-server/src/lib/securityHeaders.ts (CSP report-only by
 *    default, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)
 *    so the public HTML is covered too (#155 / launch readiness L4).
 *
 * Uses only Node.js built-in modules — no extra dependencies.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "20131", 10);
// API_PORT matches the API server's local port.  In production both services
// run on the same host so localhost works.
const API_PORT = parseInt(process.env.API_PORT ?? "8080", 10);
const DIST_DIR = path.join(__dirname, "dist", "public");

// Search-engine ownership verification tokens (#160 / launch readiness L2).
// Search Console and Bing Webmaster verifiers do not execute JavaScript, so
// the meta tags must appear in the bare HTML response — the React-side
// fallback in components/layout/index.tsx is not enough for first-time
// verification. Tokens are read from env at boot and spliced into index.html
// once; rotation requires a redeploy, which matches Search Console's "verify
// once" lifecycle.
const GOOGLE_SITE_VERIFICATION = (process.env.GOOGLE_SITE_VERIFICATION ?? "").trim();
const BING_SITE_VERIFICATION = (process.env.BING_SITE_VERIFICATION ?? "").trim();

// Security headers (#155 / launch readiness L4). Mirrors the helmet defaults
// applied to the API server in app.ts so the public HTML responses also carry
// HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy. CSP rolls
// out as Report-Only first per BACKLOG.md "SEO & web-platform debt" #1.
const CSP_REPORT_URI = (process.env.CSP_REPORT_URI ?? "/api/csp/report").trim();
const CSP_ENFORCE = process.env.CSP_ENFORCE === "1";

const ATTR_ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtmlAttr(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ATTR_ESCAPE[ch]);
}

function buildVerificationMetaTags() {
  const tags = [];
  if (GOOGLE_SITE_VERIFICATION) {
    tags.push(`<meta name="google-site-verification" content="${escapeHtmlAttr(GOOGLE_SITE_VERIFICATION)}" />`);
  }
  if (BING_SITE_VERIFICATION) {
    tags.push(`<meta name="msvalidate.01" content="${escapeHtmlAttr(BING_SITE_VERIFICATION)}" />`);
  }
  return tags.join("\n    ");
}

// Cache the rewritten index.html on first read; the file changes only on
// deploy so a single in-memory copy is fine.
let cachedIndexHtml = null;
let cachedIndexLength = null;
function getIndexHtml() {
  if (cachedIndexHtml !== null) {
    return { html: cachedIndexHtml, length: cachedIndexLength };
  }
  const indexPath = path.join(DIST_DIR, "index.html");
  let raw;
  try {
    raw = fs.readFileSync(indexPath, "utf8");
  } catch {
    return null;
  }
  const meta = buildVerificationMetaTags();
  cachedIndexHtml = meta
    ? raw.replace(/<head>/i, `<head>\n    ${meta}`)
    : raw;
  cachedIndexLength = Buffer.byteLength(cachedIndexHtml);
  return { html: cachedIndexHtml, length: cachedIndexLength };
}

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

// CSP allowlist — kept in sync with the third-party tags loaded in
// components/analytics.tsx (GA4, LinkedIn Insight, Meta Pixel) and the
// embedded surfaces (YouTube, Microsoft Bookings, Google Fonts). Adjust
// here when adding a new tag/embed.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // GA4, LinkedIn, Meta, and the inline pre-hydration theme script all need
  // 'unsafe-inline'; Vite-built JS bundles are same-origin so 'self' covers them.
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://snap.licdn.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://outlook.office365.com https://*.bookings.microsoft.com https://www.google.com",
  "connect-src 'self' https://www.google-analytics.com https://*.analytics.google.com https://stats.g.doubleclick.net https://px.ads.linkedin.com https://www.facebook.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `report-uri ${CSP_REPORT_URI}`,
].join("; ");

const CSP_HEADER_NAME = CSP_ENFORCE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  res.setHeader(CSP_HEADER_NAME, CSP_DIRECTIVES);
}

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// ─── Social bot detection ─────────────────────────────────────────────────────

const SOCIAL_BOT_PATTERNS = [
  /facebookexternalhit/i,
  /facebookcatalog/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /Slackbot/i,
  /Discordbot/i,
  /TelegramBot/i,
  /WhatsApp/i,
  /Pinterest/i,
  /Applebot/i,
  /redditbot/i,
];

function isSocialBot(ua) {
  if (!ua) return false;
  return SOCIAL_BOT_PATTERNS.some((re) => re.test(ua));
}

// ─── API proxy for OG HTML ────────────────────────────────────────────────────

function fetchOgHtml(pathname) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(pathname);
    const options = {
      hostname: "127.0.0.1",
      port: API_PORT,
      path: `/api/og?path=${encoded}`,
      method: "GET",
      headers: { Accept: "text/html" },
    };
    const req = http.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error("OG API timeout"));
    });
    req.end();
  });
}

// ─── Static file helper ───────────────────────────────────────────────────────

function serveFile(filePath, res, statusCode = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return false;

  res.writeHead(statusCode, {
    "Content-Type": mime,
    "Cache-Control": ext === ".html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "Content-Length": stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// Serve the cached, verification-meta-augmented index.html with security
// headers. Returns false if dist/public/index.html is missing.
function serveIndexHtml(res, statusCode = 200) {
  const cached = getIndexHtml();
  if (!cached) return false;
  applySecurityHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Length": cached.length,
  });
  res.end(cached.html);
  return true;
}

// ─── Request handler ──────────────────────────────────────────────────────────

function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const rawUrl = req.url ?? "/";
  const pathname = rawUrl.split("?")[0].split("#")[0] || "/";

  // 1. Intercept social bots — proxy to the API server's /api/og endpoint.
  const ua = req.headers["user-agent"] ?? "";
  if (isSocialBot(ua)) {
    fetchOgHtml(pathname)
      .then((html) => {
        applySecurityHeaders(res);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=300",
        });
        res.end(html);
      })
      .catch(() => {
        // API unavailable — fall through to serve index.html so the bot gets
        // the default OG tags from the static shell.
        if (!serveIndexHtml(res)) {
          res.writeHead(503);
          res.end("Service unavailable");
        }
      });
    return;
  }

  // 2. Exact static file match.
  const cleaned = pathname.replace(/^\/+/, "");
  const filePath = path.join(DIST_DIR, cleaned);

  // Prevent path traversal.
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (cleaned && serveFile(filePath, res)) return;

  // 3. SPA fallback — serve the cached, header-augmented index.html for all
  //    unmatched routes.
  if (serveIndexHtml(res)) return;

  res.writeHead(404);
  res.end("Not found");
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = http.createServer(handler);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`SPA server listening on port ${PORT}`);
  if (GOOGLE_SITE_VERIFICATION) {
    console.log("SPA: google-site-verification meta tag injected from GOOGLE_SITE_VERIFICATION");
  } else {
    console.warn("SPA: GOOGLE_SITE_VERIFICATION not set — Search Console verification meta tag missing from HTML");
  }
  if (BING_SITE_VERIFICATION) {
    console.log("SPA: msvalidate.01 meta tag injected from BING_SITE_VERIFICATION");
  } else {
    console.warn("SPA: BING_SITE_VERIFICATION not set — Bing Webmaster verification meta tag missing from HTML");
  }
  console.log(
    `SPA: CSP header mode = ${CSP_ENFORCE ? "enforcing (Content-Security-Policy)" : "report-only (Content-Security-Policy-Report-Only)"} — reports to ${CSP_REPORT_URI}`,
  );
});
