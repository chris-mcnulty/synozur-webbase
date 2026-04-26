import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { wixRedirectMiddleware } from "./lib/wixRedirects";
import { trafficCrawlerMiddleware } from "./middlewares/trafficCrawler";
import { attachUserIfPresent } from "./middlewares/auth";
import { handleLlmsTxt, handleRobots, handleSitemap } from "./routes/seo";
import { handlePolarisRss } from "./routes/polaris";
import { matchIndexNowKeyPath } from "./lib/seoSubmit";

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

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Native session resolver — populates `req.authedUser` and `req.session` if a
// valid `sid` cookie is present. Replaces the previous Clerk middleware.
app.use(attachUserIfPresent);

// Wix URL redirects — runs before all routing so bookmarked /post/* etc. paths
// 301 to their new home without ever reaching the SPA shell. Skips /api/*.
app.use(wixRedirectMiddleware());

// Traffic crawler logging — records pageviews for identified bot UAs hitting
// HTML routes (humans are tracked separately via the client beacon). Runs
// after wixRedirects so redirected requests aren't double-counted. Skips
// /api/*, static assets, and non-GET requests.
app.use(trafficCrawlerMiddleware());

// Site-root SEO artifacts. Also available under /api/* via the router below.
app.get("/sitemap.xml", handleSitemap);
app.get("/robots.txt", handleRobots);
app.get("/llms.txt", handleLlmsTxt);

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
