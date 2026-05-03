#!/usr/bin/env node
/**
 * Postbuild step for task #246.
 *
 * After `vite build`, the SPA's runtime depends on hashed bundle filenames
 * like `/assets/index-Ckq4wkrh.js` that change every build.  For the
 * service worker to deliver a credible offline experience, those bundles
 * must be precached on install — otherwise a user who installs the SW and
 * loses connectivity before the bundles get cached at runtime ends up with
 * a cached HTML shell that can't boot.
 *
 * This script:
 *   1. Reads the freshly-built `dist/public/index.html`.
 *   2. Extracts every same-origin `<script src>` and `<link rel="stylesheet" href>`.
 *   3. Rewrites the placeholder block in `dist/public/sw.js` so those URLs
 *      become part of `BUILD_PRECACHE_URLS`.
 *   4. Replaces the `__BUILD_ID__` token in the cache name with a content
 *      hash of the precache list, guaranteeing each deploy gets a unique
 *      cache name even if `CACHE_VERSION` isn't bumped.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "..", "dist", "public");
const INDEX_HTML = path.join(DIST_DIR, "index.html");
const SW_FILE = path.join(DIST_DIR, "sw.js");

if (!fs.existsSync(INDEX_HTML) || !fs.existsSync(SW_FILE)) {
  console.warn(
    "[inject-sw-precache] Skipping: dist/public/index.html or sw.js missing.",
  );
  process.exit(0);
}

const html = fs.readFileSync(INDEX_HTML, "utf8");

const urls = new Set();

// Match <script ... src="...">
for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
  urls.add(match[1]);
}
// Match <link rel="stylesheet" href="..."> (also captures modulepreload/preload).
for (const match of html.matchAll(
  /<link[^>]+(?:rel=["'](?:stylesheet|modulepreload|preload)["'])[^>]+href=["']([^"']+)["']/gi,
)) {
  urls.add(match[1]);
}
for (const match of html.matchAll(
  /<link[^>]+href=["']([^"']+)["'][^>]+(?:rel=["'](?:stylesheet|modulepreload|preload)["'])/gi,
)) {
  urls.add(match[1]);
}

// Keep only same-origin (root-relative) asset URLs.  Skip data:, http(s)://,
// and anything that doesn't look like a built asset path.
const sameOriginAssets = [...urls]
  .filter((u) => u.startsWith("/") && !u.startsWith("//"))
  .sort();

if (sameOriginAssets.length === 0) {
  console.warn(
    "[inject-sw-precache] No same-origin assets found in index.html — sw.js will only precache the static shell list.",
  );
}

const buildId = crypto
  .createHash("sha256")
  .update(sameOriginAssets.join("\n"))
  .digest("hex")
  .slice(0, 12);

let sw = fs.readFileSync(SW_FILE, "utf8");

// Replace the precache placeholder.
const precacheLiteral = JSON.stringify(sameOriginAssets, null, 2);
const precacheBlock = `/* __BUILD_PRECACHE_URLS_START__ */ ${precacheLiteral} /* __BUILD_PRECACHE_URLS_END__ */`;
const precachePattern = /\/\* __BUILD_PRECACHE_URLS_START__ \*\/[\s\S]*?\/\* __BUILD_PRECACHE_URLS_END__ \*\//;
if (!precachePattern.test(sw)) {
  console.error(
    "[inject-sw-precache] Could not find __BUILD_PRECACHE_URLS__ placeholder in sw.js — aborting.",
  );
  process.exit(1);
}
sw = sw.replace(precachePattern, precacheBlock);

// Replace the __BUILD_ID__ token in the cache name.
sw = sw.replace(/__BUILD_ID__/g, buildId);

fs.writeFileSync(SW_FILE, sw);
console.log(
  `[inject-sw-precache] Injected ${sameOriginAssets.length} asset URL(s) into sw.js (build id: ${buildId}).`,
);
