import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  db,
  shortLinksTable,
  shortLinkClicksTable,
  siteSettingsTable,
  type ShortLink,
} from "@workspace/db";
import { logger } from "./logger";

// In-memory cache of active short links keyed by lower-cased slug. Mirrors
// `lib/wixRedirects.ts` so the redirect path stays sub-10ms.
const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  id: string;
  targetUrl: string;
  statusCode: number;
  title: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUrl: string | null;
}

let linkCache: Map<string, CacheEntry> | null = null;
let linkCacheLoadedAt = 0;
let linkInflight: Promise<Map<string, CacheEntry>> | null = null;

// ─── Settings (DB-backed, cached) ──────────────────────────────────────────
//
// Host list, public base URL, and fallback URL all come from
// `site_settings` so admins can change them without a redeploy. We cache
// the resolved view for the same TTL as the link cache so a settings flip
// takes effect within ~60s naturally; the route layer also calls
// `invalidateShortLinkSettingsCache()` on PUT for instant updates.

const DEFAULT_PUBLIC_BASE = "https://aka.synozur.com";

interface ResolvedSettings {
  publicBase: string;
  publicHost: string;
  hosts: Set<string>;
  fallbackUrl: string | null;
}

let settingsCache: ResolvedSettings | null = null;
let settingsCacheLoadedAt = 0;
let settingsInflight: Promise<ResolvedSettings> | null = null;

function safeHostFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function loadSettings(): Promise<ResolvedSettings> {
  // `site_settings` is treated as a singleton row pinned at id=1 across the
  // codebase (see `routes/siteSettings.ts#SETTINGS_ID`). Querying by id
  // keeps us aligned with that contract instead of relying on insertion
  // order.
  const [row] = await db
    .select({
      publicBase: siteSettingsTable.shortLinkPublicBase,
      additionalHosts: siteSettingsTable.shortLinkAdditionalHosts,
      fallbackUrl: siteSettingsTable.shortLinkFallbackUrl,
    })
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1))
    .limit(1);
  const publicBase = (row?.publicBase ?? DEFAULT_PUBLIC_BASE).replace(
    /\/+$/,
    "",
  );
  const publicHost = safeHostFromUrl(publicBase) ?? "aka.synozur.com";
  const hosts = new Set<string>([publicHost]);
  for (const h of row?.additionalHosts ?? []) {
    const cleaned = h.trim().toLowerCase();
    if (cleaned) hosts.add(cleaned);
  }
  return {
    publicBase,
    publicHost,
    hosts,
    fallbackUrl: row?.fallbackUrl ?? null,
  };
}

async function getSettings(): Promise<ResolvedSettings> {
  const now = Date.now();
  if (settingsCache && now - settingsCacheLoadedAt < CACHE_TTL_MS) {
    return settingsCache;
  }
  if (settingsInflight) return settingsInflight;
  settingsInflight = loadSettings()
    .then((s) => {
      settingsCache = s;
      settingsCacheLoadedAt = Date.now();
      return s;
    })
    .catch((err) => {
      logger.error({ err }, "short-links: failed to load settings");
      // Fall back to cache if we have one, otherwise hard-coded defaults so
      // the redirect host keeps working even if the settings query fails.
      return (
        settingsCache ?? {
          publicBase: DEFAULT_PUBLIC_BASE,
          publicHost: "aka.synozur.com",
          hosts: new Set(["aka.synozur.com"]),
          fallbackUrl: null,
        }
      );
    })
    .finally(() => {
      settingsInflight = null;
    });
  return settingsInflight;
}

export function invalidateShortLinkSettingsCache(): void {
  settingsCache = null;
  settingsCacheLoadedAt = 0;
}

export async function isShortLinkHost(
  hostname: string | undefined | null,
): Promise<boolean> {
  if (!hostname) return false;
  const s = await getSettings();
  return s.hosts.has(hostname.toLowerCase());
}

export async function getShortLinkSettings(): Promise<{
  publicBase: string;
  publicHost: string;
  additionalHosts: string[];
  fallbackUrl: string | null;
}> {
  const s = await getSettings();
  // Strip the auto-derived publicHost out of the additionalHosts view so
  // the admin UI shows only the values it can edit.
  const additional = [...s.hosts].filter((h) => h !== s.publicHost).sort();
  return {
    publicBase: s.publicBase,
    publicHost: s.publicHost,
    additionalHosts: additional,
    fallbackUrl: s.fallbackUrl,
  };
}

// ─── Slug helpers ───────────────────────────────────────────────────────────

// Slug rules: lower-cased, must start with a letter or digit, then any of
// `[a-z0-9._-]`. We deliberately disallow `/` even though Rebrandly accepts
// it: the redirect middleware resolves the first path segment only, so a
// nested slug like `foo/bar` would parse as the slug `foo` at request time
// and the row would be unreachable. Keeping the validator and the
// middleware in sync prevents creating links that can never be served.
const SLUG_RE = /^[a-z0-9][a-z0-9._\-]{0,127}$/;

export function normalizeSlug(raw: string): string {
  return raw.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// ─── Link lookup cache ──────────────────────────────────────────────────────

async function loadShortLinks(): Promise<Map<string, CacheEntry>> {
  const rows = await db
    .select({
      id: shortLinksTable.id,
      slug: shortLinksTable.slug,
      targetUrl: shortLinksTable.targetUrl,
      statusCode: shortLinksTable.statusCode,
      title: shortLinksTable.title,
      ogTitle: shortLinksTable.ogTitle,
      ogDescription: shortLinksTable.ogDescription,
      ogImageUrl: shortLinksTable.ogImageUrl,
    })
    .from(shortLinksTable)
    .where(eq(shortLinksTable.active, true));
  const map = new Map<string, CacheEntry>();
  for (const r of rows) {
    map.set(r.slug, {
      id: r.id,
      targetUrl: r.targetUrl,
      statusCode: r.statusCode,
      title: r.title,
      ogTitle: r.ogTitle,
      ogDescription: r.ogDescription,
      ogImageUrl: r.ogImageUrl,
    });
  }
  return map;
}

async function getLinkCache(): Promise<Map<string, CacheEntry>> {
  const now = Date.now();
  if (linkCache && now - linkCacheLoadedAt < CACHE_TTL_MS) return linkCache;
  if (linkInflight) return linkInflight;
  linkInflight = loadShortLinks()
    .then((map) => {
      linkCache = map;
      linkCacheLoadedAt = Date.now();
      return map;
    })
    .catch((err) => {
      logger.error({ err }, "short-links: failed to load");
      return linkCache ?? new Map();
    })
    .finally(() => {
      linkInflight = null;
    });
  return linkInflight;
}

export function invalidateShortLinkCache(): void {
  linkCache = null;
  linkCacheLoadedAt = 0;
}

export async function lookupShortLink(slug: string): Promise<CacheEntry | null> {
  const map = await getLinkCache();
  return map.get(normalizeSlug(slug)) ?? null;
}

// ─── Click recording ───────────────────────────────────────────────────────

export interface ClickContext {
  ip?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
  country?: string | null;
  sessionHash?: string | null;
}

// SHA-256(ip + salt). Salt rotates per deploy unless `SHORT_LINK_IP_SALT` is
// pinned, which is the right tradeoff for click-uniqueness reporting (it
// stays stable across a single deploy's lifetime) without keeping raw IPs
// at rest. Empty IP returns null so we don't store a useless hash of "".
function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt =
    process.env.SHORT_LINK_IP_SALT ??
    process.env.SESSION_SECRET ??
    "synozur-short-links";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function recordClick(
  shortLinkId: string,
  ctx: ClickContext,
): Promise<void> {
  try {
    await Promise.all([
      db
        .update(shortLinksTable)
        .set({
          hitCount: sql`${shortLinksTable.hitCount} + 1`,
          lastClickAt: new Date(),
        })
        .where(eq(shortLinksTable.id, shortLinkId)),
      db.insert(shortLinkClicksTable).values({
        shortLinkId,
        ipHash: hashIp(ctx.ip),
        userAgent: ctx.userAgent ?? null,
        referrer: ctx.referrer ?? null,
        country: ctx.country ?? null,
        sessionHash: ctx.sessionHash ?? null,
      }),
    ]);
  } catch (err) {
    logger.warn({ err, shortLinkId }, "short-links: failed to record click");
  }
}

// Canonical public URL for a slug — used in QR codes and the admin UI's
// copy-to-clipboard action.
export async function publicShortUrl(slug: string): Promise<string> {
  const s = await getSettings();
  return `${s.publicBase}/${slug}`;
}

// Branded QR generation. We render at high error-correction (level H, ~30%
// redundancy) so the central logo overlay (~22% of the QR's width) doesn't
// break decoding. The mark is composited on a small white pad so it stays
// legible against dark modules.
let logoBufferCache: Buffer | null = null;

async function loadLogoBuffer(): Promise<Buffer | null> {
  if (logoBufferCache) return logoBufferCache;
  const candidates = [
    process.env.BRAND_QR_LOGO_PATH,
    path.resolve(
      process.cwd(),
      "../synozur/public/images/synozur-mark-color.png",
    ),
    path.resolve(
      process.cwd(),
      "artifacts/synozur/public/images/synozur-mark-color.png",
    ),
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    try {
      const buf = await readFile(p);
      logoBufferCache = buf;
      return buf;
    } catch {
      // try next candidate
    }
  }
  logger.warn(
    { tried: candidates },
    "short-links: brand mark not found; QR will render unbranded",
  );
  return null;
}

export interface QrOptions {
  /** Output edge length in pixels. Default 512. */
  size?: number;
  /** Foreground (dark module) color. Default `#000000`. */
  foreground?: string;
  /** Background color. Default `#ffffff`. */
  background?: string;
}

export async function generateBrandedQrPng(
  text: string,
  opts: QrOptions = {},
): Promise<Buffer> {
  const QRCode = (await import("qrcode")).default;
  const sharp = (await import("sharp")).default;
  const size = opts.size ?? 512;
  const fg = opts.foreground ?? "#000000";
  const bg = opts.background ?? "#ffffff";
  const qrBuf = await QRCode.toBuffer(text, {
    errorCorrectionLevel: "H",
    type: "png",
    margin: 2,
    width: size,
    color: { dark: fg, light: bg },
  });

  const logo = await loadLogoBuffer();
  if (!logo) return qrBuf;

  // Logo footprint: ~22% of the QR edge, sitting on a slightly larger white
  // pad so dark modules around the mark don't bleed into it. Both numbers
  // are conservative — level-H QR codes can survive up to ~30% obscured.
  const logoEdge = Math.round(size * 0.22);
  const padEdge = Math.round(size * 0.28);
  const padTop = Math.round((size - padEdge) / 2);
  const padLeft = Math.round((size - padEdge) / 2);
  const logoTop = Math.round((size - logoEdge) / 2);
  const logoLeft = Math.round((size - logoEdge) / 2);

  const pad = await sharp({
    create: {
      width: padEdge,
      height: padEdge,
      channels: 4,
      background: bg,
    },
  })
    .png()
    .toBuffer();

  const resizedLogo = await sharp(logo)
    .resize(logoEdge, logoEdge, { fit: "contain", background: bg })
    .png()
    .toBuffer();

  return sharp(qrBuf)
    .composite([
      { input: pad, top: padTop, left: padLeft },
      { input: resizedLogo, top: logoTop, left: logoLeft },
    ])
    .png()
    .toBuffer();
}

// ─── 404 + OG render helpers (used by the redirect middleware) ──────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface NotFoundPageOptions {
  slug: string;
  fallbackUrl: string | null;
  publicBase: string;
}

export function renderShortLinkNotFoundHtml(opts: NotFoundPageOptions): string {
  const slug = escapeHtml(opts.slug);
  const fallback = opts.fallbackUrl ? escapeHtml(opts.fallbackUrl) : null;
  const publicBase = escapeHtml(opts.publicBase);
  const fallbackHost = fallback
    ? escapeHtml(safeHostFromUrl(opts.fallbackUrl) ?? opts.fallbackUrl!)
    : null;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Link not found · Synozur</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
      Roboto, Helvetica, Arial, sans-serif;
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 2rem; background: #0b0b0c; color: #f5f5f5;
  }
  .card {
    max-width: 32rem; width: 100%; padding: 2.5rem; border-radius: 14px;
    background: #161618; border: 1px solid #2a2a2d;
  }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  p { margin: 0.5rem 0; line-height: 1.5; color: #c8c8cc; }
  code { background: #2a2a2d; padding: 0.1em 0.4em; border-radius: 4px; }
  a.cta {
    display: inline-block; margin-top: 1.25rem; padding: 0.6rem 1rem;
    border-radius: 8px; background: #f5f5f5; color: #0b0b0c;
    text-decoration: none; font-weight: 600;
  }
  a.cta:hover { background: #fff; }
</style>
</head>
<body>
<main class="card">
<h1>This short link doesn't exist.</h1>
<p>We couldn't find <code>${publicBase}/${slug}</code>.</p>
${
  fallback
    ? `<p>You can head to our main site instead:</p>
<a class="cta" href="${fallback}">Go to ${fallbackHost}</a>`
    : `<p>If you typed the URL by hand, double-check the spelling.</p>`
}
</main>
</body>
</html>`;
}

export interface OgRenderOptions {
  url: string;
  title: string;
  description: string;
  image: string | null;
}

// Minimal social-bot HTML preview. Mirrors the structure used by
// `lib/ogResolver.ts#renderOgHtml` (so unfurls look consistent with the
// rest of the site) and includes a meta-refresh + visible link as a
// graceful fallback for the rare bot that does follow the page.
export function renderShortLinkOgHtml(opts: OgRenderOptions): string {
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const img = opts.image ? escapeHtml(opts.image) : "";
  const url = escapeHtml(opts.url);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="The Synozur Alliance" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
${img ? `<meta property="og:image" content="${img}" />` : ""}
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
${img ? `<meta name="twitter:image" content="${img}" />` : ""}
<link rel="canonical" href="${url}" />
</head>
<body>
<p><a href="${url}">${t}</a></p>
<p>${d}</p>
</body>
</html>`;
}

export type ShortLinkRow = ShortLink;
