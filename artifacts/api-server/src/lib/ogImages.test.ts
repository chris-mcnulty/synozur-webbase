/**
 * Smoke-test suite: OG image file health + /api/og endpoint contract.
 *
 * For every entry in STATIC_PAGE_OG this test verifies:
 *   (a) the declared image file exists in artifacts/synozur/public/
 *   (b) the file is exactly 1200×630 pixels
 *   (c) GET /api/og?path=<route> returns the expected absolute image URL
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-images
 *
 * Designed to catch broken OG images before they reach LinkedIn or Slack.
 * File-system checks run without a DB; API checks start the full Express app.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { pool } from "@workspace/db";
import app from "../app";
import { STATIC_PAGE_OG, DEFAULT_IMAGE_PATH } from "./ogResolver";
import { siteOrigin } from "./siteOrigin";

// Resolve the synozur frontend's public directory from this file's location:
//   artifacts/api-server/src/lib/ → (3 levels up) → artifacts/ → synozur/public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYNOZUR_PUBLIC = path.resolve(__dirname, "../../../synozur/public");

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

// ─── File-system checks ────────────────────────────────────────────────────────

// Collect unique image paths declared in STATIC_PAGE_OG plus the fallback.
const uniqueImages = [
  ...new Set(Object.values(STATIC_PAGE_OG).map((e) => e.image)),
];
if (!uniqueImages.includes(DEFAULT_IMAGE_PATH)) {
  uniqueImages.push(DEFAULT_IMAGE_PATH);
}

for (const imagePath of uniqueImages) {
  // Only validate local static files; skip absolute/external URLs.
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    continue;
  }

  test(`OG image exists on disk: ${imagePath}`, () => {
    const absPath = path.join(SYNOZUR_PUBLIC, imagePath);
    assert.ok(
      fs.existsSync(absPath),
      `Missing OG image file at ${absPath}\n` +
        `This path is declared in STATIC_PAGE_OG or DEFAULT_IMAGE_PATH but the ` +
        `file does not exist in artifacts/synozur/public/. Add the file or update ` +
        `the registry entry.`,
    );
  });

  test(`OG image is ${OG_WIDTH}×${OG_HEIGHT}: ${imagePath}`, async () => {
    const absPath = path.join(SYNOZUR_PUBLIC, imagePath);
    if (!fs.existsSync(absPath)) {
      // Existence failure is already reported by the sibling test; skip.
      return;
    }
    const meta = await sharp(absPath).metadata();
    assert.equal(
      meta.width,
      OG_WIDTH,
      `${imagePath}: width is ${meta.width}px, expected ${OG_WIDTH}px. ` +
        `LinkedIn and Slack require 1200×630.`,
    );
    assert.equal(
      meta.height,
      OG_HEIGHT,
      `${imagePath}: height is ${meta.height}px, expected ${OG_HEIGHT}px. ` +
        `LinkedIn and Slack require 1200×630.`,
    );
  });
}

// ─── API endpoint checks ───────────────────────────────────────────────────────

/**
 * Extract the og:image content attribute from the HTML returned by /api/og.
 * The server HTML-escapes attribute values, so we unescape the two characters
 * that can appear in image URLs (&amp; → &, &quot; → ").
 */
function parseOgImage(html: string): string | null {
  const m = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/);
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

for (const [route, entry] of Object.entries(STATIC_PAGE_OG)) {
  test(`GET /api/og?path=${route} → correct og:image`, async () => {
    const res = await fetch(
      `${baseUrl}/api/og?path=${encodeURIComponent(route)}`,
    );
    assert.equal(
      res.status,
      200,
      `Expected HTTP 200 from /api/og?path=${route}, got ${res.status}`,
    );

    const html = await res.text();
    const ogImage = parseOgImage(html);
    assert.ok(
      ogImage !== null,
      `No <meta property="og:image"> found in /api/og response for ${route}`,
    );

    // The resolver absolutizes the image path with siteOrigin() — the test
    // process and the server share the same SITE_URL env var, so they agree.
    const expectedUrl = `${siteOrigin()}${entry.image}`;
    assert.equal(
      ogImage,
      expectedUrl,
      `og:image mismatch for ${route}\n` +
        `  expected: ${expectedUrl}\n` +
        `  received: ${ogImage}\n` +
        `Update STATIC_PAGE_OG in ogResolver.ts or verify the route is resolving correctly.`,
    );
  });
}
