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
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=300",
        });
        res.end(html);
      })
      .catch(() => {
        // API unavailable — fall through to serve index.html so the bot gets
        // the default OG tags from the static shell.
        const indexPath = path.join(DIST_DIR, "index.html");
        if (!serveFile(indexPath, res)) {
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

  // 3. SPA fallback — serve index.html for all unmatched routes.
  const indexPath = path.join(DIST_DIR, "index.html");
  if (serveFile(indexPath, res)) return;

  res.writeHead(404);
  res.end("Not found");
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = http.createServer(handler);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`SPA server listening on port ${PORT}`);
});
