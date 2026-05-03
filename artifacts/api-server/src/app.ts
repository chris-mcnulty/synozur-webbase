import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { wixRedirectMiddleware } from "./lib/wixRedirects";
import { careersRedirectMiddleware } from "./lib/careersRedirect";
import { trafficCrawlerMiddleware } from "./middlewares/trafficCrawler";
import { socialBotRendererMiddleware } from "./middlewares/socialBotRenderer";
import { attachUserIfPresent } from "./middlewares/auth";
import { handleLlmsTxt, handleRobots, handleSitemap } from "./routes/seo";
import { handlePolarisRss } from "./routes/polaris";
import oauthRouter from "./routes/oauth";
import { matchIndexNowKeyPath } from "./lib/seoSubmit";
import { securityHeadersMiddleware } from "./lib/securityHeaders";

const app: Express = express();

app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Security headers via helmet (#155 / launch readiness L4). CSP runs in
// Report-Only mode by default; flip to enforcing with CSP_ENFORCE=1 once
// the violation stream is empty for two consecutive days. Must come before
// any handler that writes a response so the headers are set on every reply.
app.use(securityHeadersMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
// #221 / #263 — Capture the raw body buffer alongside the parsed JSON so
// downstream webhook handlers can verify HMAC/ECDSA signatures against the
// exact bytes the platform signed. Used by the SendGrid event webhook
// (#221) and the HubSpot subscription webhook (#263). The buffer is a
// tiny reference attached to `req` (no copy) so this is essentially free
// for non-webhook traffic; signature handlers that want a string just
// call `.toString("utf8")`.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
// CSP violation reports use the application/csp-report media type per the
// spec; modern Chromium also accepts application/reports+json. Both are
// parsed as JSON and routed through the same body parser.
app.use(express.json({ type: ["application/csp-report", "application/reports+json"], limit: "64kb" }));
app.use(express.urlencoded({ extended: true }));

// Native session resolver — populates `req.authedUser` and `req.session` if a
// valid `sid` cookie is present. Replaces the previous Clerk middleware.
app.use(attachUserIfPresent);

// Wix URL redirects — runs before all routing so bookmarked /post/* etc. paths
// 301 to their new home without ever reaching the SPA shell. Skips /api/*.
app.use(wixRedirectMiddleware());
// #223 — Careers host-vs-redirect toggle. Mounted after the wix legacy
// redirector so its 301s win when a /careers tail also has a wix mapping,
// but before the SPA shell so the user never lands on the in-app careers
// pages while the admin has flipped the section to redirect mode.
app.use(careersRedirectMiddleware());

// Social-bot OG renderer — intercepts link-preview crawlers (LinkedIn, Slack,
// Twitter/X, Facebook, Discord, etc.) and returns a minimal HTML document with
// page-specific OG + Twitter Card tags looked up from the DB. Real browsers and
// search crawlers pass straight through unchanged.
app.use(socialBotRendererMiddleware());

// Traffic crawler logging — records pageviews for identified bot UAs hitting
// HTML routes (humans are tracked separately via the client beacon). Runs
// after wixRedirects so redirected requests aren't double-counted. Skips
// /api/*, static assets, and non-GET requests.
app.use(trafficCrawlerMiddleware());

// Site-root SEO artifacts. Also available under /api/* via the router below.
app.get("/sitemap.xml", handleSitemap);
app.get("/robots.txt", handleRobots);
app.get("/llms.txt", handleLlmsTxt);

// OAuth 2.0 / OIDC provider — mounted at site root so /.well-known/* and
// /oauth/* are available at the origin directly (RFC 8414 + OIDC Discovery).
// Must come before /api/ so these paths aren't shadowed.
app.use(oauthRouter);

// IndexNow key-validation file. Served at /<key>.txt so search engines can
// verify ownership before accepting bulk submissions. We check the path via
// matchIndexNowKeyPath (which enforces the 8-128 hex-char format) rather than
// using an inline regex in the route pattern, because Express v5 / path-to-regexp
// v8 no longer supports inline capture-group regexes in route parameters.
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  const key = matchIndexNowKeyPath(req.path);
  if (!key) return next();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(key);
});

// Podcast feed at the canonical site-root URL so directories (Apple, Spotify,
// Amazon Music) can consume it without an `/api/` prefix. The same handler is
// also available under /api/polaris/rss.xml via the router below (#101).
app.get("/polaris/rss.xml", handlePolarisRss);

app.use("/api", router);

export default app;
