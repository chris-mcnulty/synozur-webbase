import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  db,
  shortLinksTable,
  shortLinkClicksTable,
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
}

let cache: Map<string, CacheEntry> | null = null;
let cacheLoadedAt = 0;
let inflight: Promise<Map<string, CacheEntry>> | null = null;

// Hosts on which `/<slug>` should resolve as a branded short link. Defaults
// cover prod plus a couple of local-dev aliases. Override at deploy time
// via `SHORT_LINK_HOSTS=aka.synozur.com,go.synozur.com`.
export function shortLinkHosts(): Set<string> {
  const raw =
    process.env.SHORT_LINK_HOSTS ?? "aka.synozur.com,aka.localhost";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isShortLinkHost(hostname: string | undefined | null): boolean {
  if (!hostname) return false;
  return shortLinkHosts().has(hostname.toLowerCase());
}

// Slug rules: Rebrandly accepts `[a-zA-Z0-9-_./]+`. We collapse case (slugs
// match case-insensitively) and forbid characters that would change URL
// semantics (`?`, `#`, whitespace). Keeps existing Rebrandly slugs valid
// while preventing surprises like `/Foo` and `/foo` resolving differently.
const SLUG_RE = /^[a-z0-9][a-z0-9._\-/]{0,127}$/;

export function normalizeSlug(raw: string): string {
  return raw.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

async function loadShortLinks(): Promise<Map<string, CacheEntry>> {
  const rows = await db
    .select({
      id: shortLinksTable.id,
      slug: shortLinksTable.slug,
      targetUrl: shortLinksTable.targetUrl,
      statusCode: shortLinksTable.statusCode,
    })
    .from(shortLinksTable)
    .where(eq(shortLinksTable.active, true));
  const map = new Map<string, CacheEntry>();
  for (const r of rows) {
    map.set(r.slug, {
      id: r.id,
      targetUrl: r.targetUrl,
      statusCode: r.statusCode,
    });
  }
  return map;
}

async function getCache(): Promise<Map<string, CacheEntry>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = loadShortLinks()
    .then((map) => {
      cache = map;
      cacheLoadedAt = Date.now();
      return map;
    })
    .catch((err) => {
      logger.error({ err }, "short-links: failed to load");
      return cache ?? new Map();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateShortLinkCache(): void {
  cache = null;
  cacheLoadedAt = 0;
}

export async function lookupShortLink(slug: string): Promise<CacheEntry | null> {
  const map = await getCache();
  return map.get(normalizeSlug(slug)) ?? null;
}

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
// copy-to-clipboard action. Honours `SHORT_LINK_PUBLIC_BASE` so staging /
// preview environments can issue QRs that point at their own host.
export function publicShortUrl(slug: string): string {
  const base = (
    process.env.SHORT_LINK_PUBLIC_BASE ?? "https://aka.synozur.com"
  ).replace(/\/+$/, "");
  return `${base}/${slug}`;
}

// Branded QR generation. We render at high error-correction (level H, ~30%
// redundancy) so the central logo overlay (~22% of the QR's width) doesn't
// break decoding. The mark is composited on a small white pad so it stays
// legible against dark modules. Output is PNG; admins can also request SVG
// via the route layer for vector reuse.
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
  // Imported lazily so the bundler doesn't pull qrcode/sharp into hot paths
  // that don't need them.
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

export type ShortLinkRow = ShortLink;
