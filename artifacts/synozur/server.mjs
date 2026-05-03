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
// components/analytics.tsx (GA4, LinkedIn Insight, Meta Pixel), the
// embedded surfaces (YouTube, Microsoft Bookings, Google Fonts), the
// Cloudflare Turnstile widget on contact/subscribe/start forms, and the
// Libsyn player on the Polaris page. Adjust here AND in
// artifacts/api-server/src/lib/securityHeaders.ts when adding a new
// tag/embed.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // GA4, LinkedIn, Meta, and the inline pre-hydration theme script all need
  // 'unsafe-inline'; Vite-built JS bundles are same-origin so 'self' covers them.
  // Cloudflare Turnstile loads its widget JS from challenges.cloudflare.com.
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://snap.licdn.com https://connect.facebook.net https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  // Cloudflare Turnstile renders its challenge inside a Turnstile-hosted iframe.
  // Libsyn player is embedded as an iframe on the Polaris page.
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://outlook.office365.com https://*.bookings.microsoft.com https://www.google.com https://challenges.cloudflare.com https://play.libsyn.com",
  // Cloudflare Turnstile makes validation XHR calls back to challenges.cloudflare.com.
  "connect-src 'self' https://www.google-analytics.com https://*.analytics.google.com https://stats.g.doubleclick.net https://px.ads.linkedin.com https://www.facebook.com https://challenges.cloudflare.com",
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
  ".webmanifest": "application/manifest+json",
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

// ─── Publish-status probe (#162 / launch-readiness L13) ──────────────────────

// SPA URLs that map 1:1 to a DB-backed artifact. We only ask the API about
// routes shaped like `/<section>/<slug>` — anything else is static and
// shortcuts to 200. Helpers live in `./lib/artifactPath.mjs` so they can be
// unit-tested without starting the HTTP listener.
import { isArtifactPath } from "./lib/artifactPath.mjs";

// Ask the API server whether `pathname` is currently published. Returns
// "ok" / "not_found" / "gone" — or "ok" on any timeout/error so a wobble
// in the API never makes Google de-index live content.
function fetchRouteStatus(pathname) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(pathname);
    const options = {
      hostname: "127.0.0.1",
      port: API_PORT,
      path: `/api/seo/route-status?path=${encoded}`,
      method: "GET",
      headers: { Accept: "application/json" },
    };
    const req = http.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const status = parsed && typeof parsed.status === "string" ? parsed.status : "ok";
          resolve(status === "gone" || status === "not_found" ? status : "ok");
        } catch {
          resolve("ok");
        }
      });
    });
    req.on("error", () => resolve("ok"));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve("ok");
    });
    req.end();
  });
}

// ─── API proxy for SEO surfaces ───────────────────────────────────────────────

// `/sitemap.xml`, `/robots.txt`, and `/llms.txt` are produced dynamically by
// the api-server (see artifacts/api-server/src/routes/seo.ts) but the shared
// reverse proxy routes the synozur artifact's `paths = ["/"]` catch-all
// before any api-server-owned prefix could claim them, so the api-server's
// handlers were unreachable from end users (and from the CI link-check
// workflow which points LINK_CHECK_BASE_URL at this server). Forward those
// three paths to the api-server so crawlers and the broken-link checker
// receive the real sitemap instead of the SPA shell. Surfaced by task #271
// while running the link-check against a content-populated environment for
// the first time.
const SEO_PROXY_PATHS = new Set(["/sitemap.xml", "/robots.txt", "/llms.txt"]);

function proxySeoPath(req, res, pathname) {
  const options = {
    hostname: "127.0.0.1",
    port: API_PORT,
    path: pathname,
    method: req.method,
    headers: {
      Accept: req.headers["accept"] ?? "*/*",
      "User-Agent": req.headers["user-agent"] ?? "synozur-seo-proxy",
      Host: req.headers["host"] ?? `127.0.0.1:${API_PORT}`,
    },
  };
  const upstream = http.request(options, (upRes) => {
    const headers = { ...upRes.headers };
    // Strip hop-by-hop headers that node would otherwise echo back to the
    // client and that don't make sense across this internal hop.
    delete headers["transfer-encoding"];
    delete headers["connection"];
    res.writeHead(upRes.statusCode ?? 502, headers);
    upRes.pipe(res);
  });
  upstream.on("error", (err) => {
    console.warn(`SPA: SEO proxy ${pathname} -> api-server failed: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad gateway");
    } else {
      res.end();
    }
  });
  upstream.setTimeout(4000, () => {
    upstream.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { "Content-Type": "text/plain" });
      res.end("Gateway timeout");
    } else {
      res.end();
    }
  });
  upstream.end();
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

// Files that must always be re-validated by the browser even though they
// aren't HTML. Service workers in particular MUST NOT be cached for long
// or users get stuck on an old SW after a deploy (task #246). The web
// manifest and offline fallback are revalidated for the same reason.
const REVALIDATE_BASENAMES = new Set([
  "sw.js",
  "manifest.webmanifest",
  "offline.html",
]);

function serveFile(filePath, res, statusCode = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return false;

  const basename = path.basename(filePath);
  let cacheControl;
  if (ext === ".html" || REVALIDATE_BASENAMES.has(basename)) {
    cacheControl = "no-cache";
  } else {
    cacheControl = "public, max-age=31536000, immutable";
  }

  const headers = {
    "Content-Type": mime,
    "Cache-Control": cacheControl,
    "Content-Length": stat.size,
  };
  // Service workers require an explicit Service-Worker-Allowed header to
  // claim a scope broader than their own path; here it's same-level as the
  // SW itself but we set it explicitly for clarity.
  if (basename === "sw.js") {
    headers["Service-Worker-Allowed"] = "/";
  }

  res.writeHead(statusCode, headers);
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

  // 1. SEO surfaces (sitemap.xml / robots.txt / llms.txt) live on the
  //    api-server but the shared reverse proxy gives this artifact's
  //    `paths = ["/"]` catch-all priority over the api-server, so we
  //    forward those three paths internally.
  if (SEO_PROXY_PATHS.has(pathname)) {
    proxySeoPath(req, res, pathname);
    return;
  }

  // 2. Intercept social bots — proxy to the API server's /api/og endpoint.
  //    Bots also see the publish-status verdict so unfurls of an archived
  //    URL don't show a stale preview.
  const ua = req.headers["user-agent"] ?? "";
  if (isSocialBot(ua)) {
    const statusProbe = isArtifactPath(pathname)
      ? fetchRouteStatus(pathname)
      : Promise.resolve("ok");
    Promise.all([statusProbe, fetchOgHtml(pathname).catch(() => null)])
      .then(([routeStatus, html]) => {
        applySecurityHeaders(res);
        const httpStatus =
          routeStatus === "gone" ? 410 : routeStatus === "not_found" ? 404 : 200;
        if (!html) {
          // OG endpoint failed — fall back to the static shell so the bot
          // still gets default OG tags. Status verdict still propagates.
          const cached = getIndexHtml();
          if (!cached) {
            res.writeHead(503);
            res.end("Service unavailable");
            return;
          }
          res.writeHead(httpStatus, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            "Content-Length": cached.length,
          });
          res.end(cached.html);
          return;
        }
        res.writeHead(httpStatus, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=300",
        });
        res.end(html);
      });
    return;
  }

  // 3. Exact static file match.
  const cleaned = pathname.replace(/^\/+/, "");
  const filePath = path.join(DIST_DIR, cleaned);

  // Prevent path traversal.
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Requests for /index.html must go through serveIndexHtml() so they receive
  // the same verification-meta splice and security headers as every other HTML
  // response.  Bypassing this by letting serveFile() handle the path would
  // serve the raw, unmodified file without the injected tags or CSP header.
  if (cleaned === "index.html") {
    serveIndexHtml(res);
    return;
  }

  if (cleaned && serveFile(filePath, res)) return;

  // 4. SPA fallback. For canonical artifact URLs (`/insights/:slug` etc.)
  //    consult the API to decide whether this URL is still published. The
  //    HTML body is the same SPA shell — the React app handles rendering a
  //    friendly Gone / Not Found page client-side — but the HTTP status is
  //    410 / 404 / 200 so Google can de-index promptly (#162 / L13).
  if (isArtifactPath(pathname)) {
    fetchRouteStatus(pathname).then((routeStatus) => {
      const httpStatus =
        routeStatus === "gone" ? 410 : routeStatus === "not_found" ? 404 : 200;
      if (!serveIndexHtml(res, httpStatus)) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    return;
  }

  // Non-artifact unmatched routes — serve the SPA shell with 200 as before.
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
