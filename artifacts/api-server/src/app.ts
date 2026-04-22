import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { wixRedirectMiddleware } from "./lib/wixRedirects";
import { trafficCrawlerMiddleware } from "./middlewares/trafficCrawler";
import { handleRobots, handleSitemap } from "./routes/seo";
import { handlePolarisRss } from "./routes/polaris";

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

// Clerk proxy must run BEFORE body parsers (it streams raw bytes).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Clerk session middleware — populates getAuth(req) for downstream handlers.
app.use(clerkMiddleware());

// Wix URL redirects — runs before all routing so bookmarked /post/* etc. paths
// 301 to their new home without ever reaching the SPA shell. Skips /api/*.
app.use(wixRedirectMiddleware());

// Traffic crawler logging — records pageviews for identified bot UAs hitting
// HTML routes (humans are tracked separately via the client beacon). Runs
// after wixRedirects so redirected requests aren't double-counted. Skips
// /api/*, /__clerk, static assets, and non-GET requests.
app.use(trafficCrawlerMiddleware());

// Site-root SEO artifacts. Also available under /api/* via the router below.
app.get("/sitemap.xml", handleSitemap);
app.get("/robots.txt", handleRobots);

// Podcast feed at the canonical site-root URL so directories (Apple, Spotify,
// Amazon Music) can consume it without an `/api/` prefix. The same handler is
// also available under /api/polaris/rss.xml via the router below (#101).
app.get("/polaris/rss.xml", handlePolarisRss);

app.use("/api", router);

export default app;
