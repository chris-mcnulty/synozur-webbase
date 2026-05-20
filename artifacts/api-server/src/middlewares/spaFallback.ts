/**
 * SPA fallback middleware for social-bot-intercepted content paths.
 *
 * When a non-social-bot request arrives at the api-server on a content
 * path (e.g. /insights/:slug, /solutions/:slug) — which the Synozur SPA
 * normally handles — this middleware bridges the gap:
 *
 *   Development:  proxies to the Vite dev server so the SPA boots with
 *                 full HMR. Vite asset requests (/@vite/client, HMR
 *                 WebSocket) still go directly to the SPA at "/" so hot
 *                 reload is unaffected.
 *   Production:   serves the pre-built index.html from the SPA's dist
 *                 directory. All SPA routing happens client-side after
 *                 the shell loads.
 *
 * Mount this AFTER all api-server route handlers so Express only reaches
 * it for requests that weren't handled by any earlier handler.
 */

import { type RequestHandler } from "express";
import { request as httpRequest } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { resolve } from "node:path";

const SPA_PORT = process.env["SYNOZUR_SPA_PORT"] ?? "20131";
const SPA_DIST = resolve(process.cwd(), "artifacts/synozur/dist/public");
const INDEX_HTML = resolve(SPA_DIST, "index.html");

export function spaFallbackMiddleware(): RequestHandler {
  if (process.env["NODE_ENV"] === "production") {
    return (_req, res, next) => {
      if (!existsSync(INDEX_HTML)) return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      createReadStream(INDEX_HTML).pipe(res);
    };
  }

  return (req, res, next) => {
    const proxyReq = httpRequest(
      {
        hostname: "localhost",
        port: Number(SPA_PORT),
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `localhost:${SPA_PORT}`,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      },
    );
    proxyReq.on("error", (err) => {
      req.log?.warn?.({ err }, "spaFallback: proxy to Vite failed — passing through");
      next();
    });
    if (req.readable) {
      req.pipe(proxyReq, { end: true });
    } else {
      proxyReq.end();
    }
  };
}
