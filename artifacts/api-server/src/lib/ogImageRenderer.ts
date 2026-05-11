/**
 * Dynamic OG image renderer (#161 / launch-readiness L14).
 *
 * Produces a 1200×630 PNG with the brand gradient, wordmark, kind badge,
 * artifact title, and author/byline block. Built on `sharp` which is
 * already a runtime dep — no `@vercel/og` / satori bundle to ship. The
 * SVG template is rendered via librsvg through `sharp({ density: 96 })`
 * and composed onto the gradient base via `sharp.composite`.
 *
 * Text wrapping is done in JS rather than via `<foreignObject>` because
 * librsvg ignores the latter. Approximate character widths are tuned for
 * the system fallback fonts used by librsvg in the api-server runtime
 * (Liberation Sans on Linux); the wrap function is intentionally
 * conservative so longer titles never bleed past the safe area.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

export type OgImageKind = "insight" | "case-study" | "white-paper" | "polaris" | "landing-page";

/**
 * Renderer template version. Embedded in the cache key alongside the
 * row's `lastModifiedMs` so any template change (logo size, layout
 * tweak, font swap) globally invalidates previously cached PNGs without
 * touching every row's `updated_at`. Bump on every visible change.
 *
 * Bump history:
 *   1 — initial release (#161, May 2026).
 *   2 — Synozur logo doubled in size (May 2026).
 *   3 — Fixed logo path resolution so logo renders in bundled production build (May 2026).
 */
export const OG_TEMPLATE_VERSION = 3;

export interface OgImageInput {
  kind: OgImageKind;
  title: string;
  /** Author name for posts, host name for polaris, etc. May be null. */
  byline?: string | null;
  /**
   * Optional avatar URL (e.g. `usersTable.avatarUrl`). Fetched at render
   * time and embedded as a base64 data URI inside the SVG so librsvg
   * doesn't need network access. Falls back to the initials circle if the
   * fetch fails or the URL is omitted.
   */
  avatarUrl?: string | null;
  /** Optional sub-line — e.g. client name for case studies, doc type for white papers. */
  context?: string | null;
}

const WIDTH = 1200;
const HEIGHT = 630;

const KIND_LABELS: Record<OgImageKind, string> = {
  insight: "Insights",
  "case-study": "Case Study",
  "white-paper": "White Paper",
  polaris: "Polaris",
  "landing-page": "Landing Page",
};

// Brand palette mirrors `--synozur-*` HSL values from
// `artifacts/synozur/src/index.css`. Hard-coded as hex here so the
// image renders identically regardless of which DOM the request came
// from.
const BRAND = {
  violet: "#7E16FB",
  purple: "#52297F",
  magenta: "#E51AAA",
  blue: "#1F70F4",
  ink: "#0B0820",
  white: "#FFFFFF",
};

// ─── White horizontal logo ────────────────────────────────────────────────────
// The logo PNG lives in synozur's public assets. We read it from the filesystem
// once and cache it as a base64 data URI so librsvg can embed it without
// network access. Falls back to null gracefully — the SVG then renders the
// text wordmark as before.

let _logoDataUri: string | null | undefined = undefined; // undefined = not yet attempted

function getLogoDataUri(): string | null {
  if (_logoDataUri !== undefined) return _logoDataUri;
  try {
    // process.cwd() is the api-server package dir when run via pnpm --filter.
    // The synozur public assets sit one directory up at artifacts/synozur/.
    const candidates = [
      // __dirname in the esbuild bundle = artifacts/api-server/dist (two levels up to artifacts/)
      resolve(__dirname, "../../synozur/public/images/sa-logo-horizontal-white.png"),
      // __dirname in ts-node / tsx dev mode = artifacts/api-server/src/lib (three levels up to artifacts/)
      resolve(__dirname, "../../../synozur/public/images/sa-logo-horizontal-white.png"),
      // cwd-based fallbacks
      resolve(process.cwd(), "../synozur/public/images/sa-logo-horizontal-white.png"),
      resolve(process.cwd(), "artifacts/synozur/public/images/sa-logo-horizontal-white.png"),
    ];
    for (const p of candidates) {
      try {
        const buf = readFileSync(p);
        _logoDataUri = `data:image/png;base64,${buf.toString("base64")}`;
        return _logoDataUri;
      } catch {
        // try next candidate
      }
    }
    _logoDataUri = null;
  } catch {
    _logoDataUri = null;
  }
  return _logoDataUri;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wrap text into a fixed number of lines based on a coarse character
 * budget. Truncates with an ellipsis if the title overflows the last
 * line — better than letting it bleed off the safe area at 1200×630.
 */
function wrapTitle(title: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines && words.length > 0) {
    // Check if anything was dropped.
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) {
      const last = lines[maxLines - 1];
      if (last.length > maxCharsPerLine - 1) {
        lines[maxLines - 1] = last.slice(0, maxCharsPerLine - 1) + "…";
      } else {
        lines[maxLines - 1] = last + "…";
      }
    }
  }
  return lines;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "S";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Best-effort fetch of the author's avatar as a data URI suitable for
 * inlining in `<image href="…">`. Returns `null` on any failure so the
 * renderer can gracefully fall back to the initials circle. We hard-cap
 * the response to 512 KB and the fetch to 2 s to keep cold-cache OG
 * renders snappy and to defend against hostile remote URLs.
 */
async function fetchAvatarDataUri(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 512 * 1024) return null;
    // Re-encode to a square PNG via sharp so the SVG `<image>` can place
    // it inside a circular clip-path without alignment surprises and so
    // we drop arbitrary upstream payload (EXIF, ICC profiles, etc.).
    const png = await sharp(buf)
      .resize(128, 128, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

// ─── SVG builder ──────────────────────────────────────────────────────────────

function buildSvg(
  input: OgImageInput,
  avatarDataUri: string | null,
  logoDataUri: string | null,
): string {
  const kindLabel = KIND_LABELS[input.kind];
  // maxCharsPerLine=22 is calibrated for font-size 68px bold on Liberation Sans
  // (librsvg's system font on Linux). At ~46px/char avg, 22 chars ≈ 1012px which
  // comfortably fits in the 1040px safe area (1200 - 2×80 margin).
  const titleLines = wrapTitle(input.title || "Untitled", 22, 3);
  const lineHeight = 80;
  const titleStartY = 290 - (titleLines.length - 1) * (lineHeight / 2);

  const byline = input.byline?.trim() || "";
  const context = input.context?.trim() || "";
  const initials = byline ? initialsFor(byline) : "SA";

  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="80" y="${titleStartY + i * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  // ── Wordmark: real logo image when available, text fallback otherwise ────────
  // Logo is the white horizontal version of the Synozur Alliance mark.
  // Source dimensions: ~231×63 (3.67:1 aspect ratio). Rendered at 72px tall
  // → width ≈ 264px; positioned at y=4 so the 72px-tall logo still fits
  // inside the 80px top stripe (y=4..76, hairline at y=80).
  const LOGO_H = 72;
  const LOGO_W = Math.round(LOGO_H * (231 / 63)); // ≈ 264
  const LOGO_Y = Math.round((80 - LOGO_H) / 2);   // ≈ 4 — centred in top stripe

  const wordmark = logoDataUri
    ? `<image href="${logoDataUri}" x="80" y="${LOGO_Y}" width="${LOGO_W}" height="${LOGO_H}"
             preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="80" y="56" font-family="Avenir Next, Inter, Arial, sans-serif" font-size="26" font-weight="700"
             fill="${BRAND.white}" letter-spacing="0.5">THE SYNOZUR ALLIANCE</text>`;

  // Avatar tile: real PNG when an `avatarUrl` was provided and fetched
  // successfully, otherwise the initials disc. Both are clipped to a
  // 68px circle at the same coordinates so the byline row looks
  // identical regardless of which path renders.
  const avatarTile = avatarDataUri
    ? `<defs>
        <clipPath id="ogAvatarClip">
          <circle cx="34" cy="34" r="34"/>
        </clipPath>
      </defs>
      <image href="${avatarDataUri}" x="0" y="0" width="68" height="68"
             clip-path="url(#ogAvatarClip)" preserveAspectRatio="xMidYMid slice"/>
      <circle cx="34" cy="34" r="34" fill="none"
              stroke="${BRAND.white}" stroke-opacity="0.4" stroke-width="2"/>`
    : `<circle cx="34" cy="34" r="34" fill="${BRAND.white}" fill-opacity="0.12" stroke="${BRAND.white}" stroke-opacity="0.4" stroke-width="2"/>
       <text x="34" y="34" font-family="Avenir Next, Inter, Arial, sans-serif" font-size="26" font-weight="700"
             fill="${BRAND.white}" text-anchor="middle" dominant-baseline="central">${escapeXml(initials)}</text>`;

  // Bottom byline row: avatar tile (real or initials) plus name + optional
  // context. Skipped entirely if no byline so case-study / white-paper
  // renders cleanly.
  const bylineRow = byline
    ? `
    <g transform="translate(80, 510)">
      ${avatarTile}
      <text x="86" y="28" font-family="Avenir Next, Inter, Arial, sans-serif" font-size="26" font-weight="600" fill="${BRAND.white}">${escapeXml(byline)}</text>
      ${
        context
          ? `<text x="86" y="58" font-family="Avenir Next, Inter, Arial, sans-serif" font-size="22" font-weight="400" fill="${BRAND.white}" fill-opacity="0.75">${escapeXml(context)}</text>`
          : ""
      }
    </g>`
    : context
      ? `
    <g transform="translate(80, 530)">
      <text x="0" y="0" font-family="Avenir Next, Inter, Arial, sans-serif" font-size="26" font-weight="500" fill="${BRAND.white}" fill-opacity="0.85">${escapeXml(context)}</text>
    </g>`
      : "";

  // Approximate badge width — librsvg has no text-length metrics we can
  // call from JS, so we size to the longest known kind label.
  const badgeWidth = Math.max(160, kindLabel.length * 16 + 48);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.ink}"/>
      <stop offset="35%" stop-color="${BRAND.purple}"/>
      <stop offset="70%" stop-color="${BRAND.violet}"/>
      <stop offset="100%" stop-color="${BRAND.magenta}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.15" r="0.6">
      <stop offset="0%" stop-color="${BRAND.blue}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${BRAND.blue}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>

  <!-- Decorative hairlines -->
  <line x1="0" y1="80" x2="${WIDTH}" y2="80" stroke="${BRAND.white}" stroke-opacity="0.15" stroke-width="1"/>
  <line x1="0" y1="${HEIGHT - 80}" x2="${WIDTH}" y2="${HEIGHT - 80}" stroke="${BRAND.white}" stroke-opacity="0.15" stroke-width="1"/>

  <!-- Wordmark, top-left -->
  ${wordmark}

  <!-- Kind badge, top-right -->
  <g transform="translate(${WIDTH - 80 - badgeWidth}, 18)">
    <rect width="${badgeWidth}" height="44" rx="22" ry="22"
          fill="${BRAND.white}" fill-opacity="0.14"
          stroke="${BRAND.white}" stroke-opacity="0.5" stroke-width="1.5"/>
    <text x="${badgeWidth / 2}" y="22" font-family="Avenir Next, Inter, Arial, sans-serif" font-size="20"
          font-weight="600" fill="${BRAND.white}" text-anchor="middle"
          dominant-baseline="central" letter-spacing="0.4">${escapeXml(kindLabel.toUpperCase())}</text>
  </g>

  <!-- Title -->
  <text font-family="Avenir Next, Inter, Arial, sans-serif" font-size="68" font-weight="800" fill="${BRAND.white}">
    ${titleTspans}
  </text>

  ${bylineRow}
</svg>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render the OG image as a PNG buffer. Returns 1200×630 RGB PNG bytes.
 */
export async function renderOgImagePng(input: OgImageInput): Promise<Buffer> {
  const [avatarDataUri, logoDataUri] = await Promise.all([
    input.avatarUrl && input.byline ? fetchAvatarDataUri(input.avatarUrl) : Promise.resolve(null),
    Promise.resolve(getLogoDataUri()),
  ]);
  const svg = buildSvg(input, avatarDataUri, logoDataUri);
  return await sharp(Buffer.from(svg, "utf-8"), { density: 96 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
