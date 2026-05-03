import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";
import { logger } from "./logger";

// #223 — Careers host-vs-redirect middleware. When `site_settings.careers_mode`
// is "redirect" and `careers_external_url` is set, every request whose path
// begins with /careers (and embed paths) 301s to the configured external URL
// preserving the path tail. Otherwise the request falls through to the SPA
// shell so the native careers section renders.
//
// Settings are cached in-memory with a short TTL so the toggle takes effect on
// the next request without per-request DB load. invalidateCareersSettings()
// is called from the settings mutation route to flush instantly.

const CACHE_TTL_MS = 30 * 1000;

interface CareersConfig {
  mode: "native" | "redirect";
  externalUrl: string | null;
}

let cache: CareersConfig | null = null;
let cacheLoadedAt = 0;
let inflight: Promise<CareersConfig> | null = null;

async function loadCareersConfig(): Promise<CareersConfig> {
  const [row] = await db
    .select({
      mode: siteSettingsTable.careersMode,
      externalUrl: siteSettingsTable.careersExternalUrl,
    })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1));
  const mode = (row?.mode === "redirect" ? "redirect" : "native") as
    | "native"
    | "redirect";
  return { mode, externalUrl: row?.externalUrl ?? null };
}

async function getConfig(): Promise<CareersConfig> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = loadCareersConfig()
    .then((c) => {
      cache = c;
      cacheLoadedAt = Date.now();
      return c;
    })
    .catch((err) => {
      logger.error({ err }, "careers-redirect: failed to load settings");
      return cache ?? { mode: "native" as const, externalUrl: null };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateCareersSettings(): void {
  cache = null;
  cacheLoadedAt = 0;
}

export function isCareersPath(path: string): boolean {
  if (!path) return false;
  return path === "/careers" || path.startsWith("/careers/");
}

export function buildRedirectTarget(
  externalUrl: string,
  reqPath: string,
  qs: string,
): string {
  // Strip the /careers prefix and append the remainder so
  // /careers/jobs/abc → https://careers.example.com/jobs/abc.
  const tail = reqPath === "/careers" ? "" : reqPath.slice("/careers".length);
  const base = externalUrl.replace(/\/+$/, "");
  return `${base}${tail}${qs}`;
}

export function careersRedirectMiddleware() {
  return async function (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const path = req.path || "/";
    if (!isCareersPath(path)) return next();
    // Never redirect API traffic.
    if (path.startsWith("/api/")) return next();
    try {
      const cfg = await getConfig();
      if (cfg.mode !== "redirect") return next();
      if (!cfg.externalUrl) return next();
      const qs = req.originalUrl.includes("?")
        ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
        : "";
      const target = buildRedirectTarget(cfg.externalUrl, path, qs);
      res.redirect(301, target);
    } catch (err) {
      logger.error({ err, path }, "careers-redirect: middleware error");
      next();
    }
  };
}
