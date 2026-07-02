/**
 * Smoke-test suite: OG image health for DB-driven content (Insights posts
 * and Events), not just the hand-coded static routes covered by
 * `ogImages.test.ts`.
 *
 * Static pages ship a fixed image file we can check on disk. Blog posts and
 * events instead resolve their share image from uploaded media / DB fields
 * at request time (via `ogResolver.ts`). If that media is deleted, mis-sized,
 * or was never uploaded, the shared link silently ships a blank or wrong-sized
 * social card — and nothing catches it before it reaches LinkedIn or Slack.
 *
 * For a representative sample of published posts and upcoming events this test:
 *   (a) resolves og:image via GET /api/og?path=<route>
 *   (b) confirms that image is reachable and a healthy, correctly-sized card
 *
 * How each resolved image is verified depends on its URL shape:
 *   - same-origin `/api/*` (storage resize variant `?w=1200&fmt=jpeg` or the
 *     generated `/api/og/image` card): re-pointed at THIS test server and
 *     fetched, so the check exercises the local build rather than whatever is
 *     currently deployed. Asserted to be a reachable image at the canonical
 *     1200px OG width with a landscape (height ≤ width) aspect.
 *   - same-origin static file (e.g. the `/opengraph.jpg` site default): the
 *     api-server doesn't serve the frontend's static assets, so it's validated
 *     on disk in `artifacts/synozur/public/` at exactly 1200×630 — matching
 *     `ogImages.test.ts`.
 *   - external absolute URL (rare — an editor-pasted image host): fetched
 *     directly and asserted reachable + decodable as an image.
 *
 * Height is intentionally NOT pinned to 630 for the resized variants because
 * the storage resize preserves each original's aspect ratio (e.g. 1200×800,
 * 1200×670). Width is the reliable invariant: healthy dynamic images are
 * always served at 1200px wide.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-dynamic
 *
 * Hits the real DATABASE_URL (dev is the primary content DB). Read-only: it
 * only samples existing rows and fetches their resolved images.
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
import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { db, pool, postsTable, eventsTable } from "@workspace/db";
import app from "../app";
import { siteOrigin } from "./siteOrigin";

// Canonical OG long edge. Every healthy share image the server resolves is
// served at this width — either the storage resize variant (?w=1200) or the
// generated 1200×630 card. See ogResolver.ts:OG_IMAGE_WIDTH / ogImages.test.ts.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// How many rows to sample per content type. Enough to catch systemic breakage
// without turning the suite into a full-catalog crawl (each row does two
// HTTP round-trips: /api/og + the image fetch).
const SAMPLE_SIZE = 20;

// artifacts/api-server/src/lib/ → (3 levels up) → artifacts/ → synozur/public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SYNOZUR_PUBLIC = path.resolve(__dirname, "../../../synozur/public");

const ORIGIN = siteOrigin();

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

/**
 * Extract the og:image content attribute from the HTML returned by /api/og.
 * The server HTML-escapes attribute values, so unescape the two characters
 * that can appear in image URLs (&amp; → &, &quot; → ").
 */
function parseOgImage(html: string): string | null {
  const m = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/);
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

/** Fetch a URL and decode it with sharp, returning status/type/metadata. */
async function fetchImage(
  url: string,
  label: string,
): Promise<{ status: number; contentType: string; meta: sharp.Metadata }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    assert.fail(
      `${label}: og:image URL is unreachable (${url}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assert.equal(
    res.status,
    200,
    `${label}: og:image returned HTTP ${res.status} (${url}). ` +
      `The linked media is likely deleted or missing — the share card will be blank.`,
  );
  const contentType = res.headers.get("content-type") ?? "";
  assert.ok(
    contentType.startsWith("image/"),
    `${label}: og:image content-type is "${contentType}", expected image/* (${url}). ` +
      `Crawlers such as LinkedIn may drop a non-image response, leaving a blank card.`,
  );
  const buf = Buffer.from(await res.arrayBuffer());
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch (err) {
    assert.fail(
      `${label}: og:image is not a decodable image (${url}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assert.ok(
    meta.width && meta.height,
    `${label}: og:image has no readable dimensions (${url}).`,
  );
  return { status: res.status, contentType, meta };
}

/**
 * Resolve the og:image for `route` and assert it's a reachable, healthy card.
 * `label` names the content in failure messages (e.g. "post: my-slug").
 */
async function assertHealthyOgImage(route: string, label: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/og?path=${encodeURIComponent(route)}`);
  assert.equal(
    res.status,
    200,
    `${label}: expected HTTP 200 from /api/og?path=${route}, got ${res.status}`,
  );

  const html = await res.text();
  const ogImage = parseOgImage(html);
  assert.ok(
    ogImage && ogImage.trim().length > 0,
    `${label}: no <meta property="og:image"> in /api/og response for ${route}. ` +
      `The share link would render with no image.`,
  );
  assert.ok(
    /^https?:\/\//.test(ogImage),
    `${label}: og:image is not an absolute URL: "${ogImage}". ` +
      `Crawlers require an absolute URL.`,
  );

  let parsed: URL;
  try {
    parsed = new URL(ogImage);
  } catch {
    assert.fail(`${label}: og:image is not a valid URL: "${ogImage}".`);
  }

  const sameOrigin = `${parsed.protocol}//${parsed.host}` === ORIGIN;

  // ── Static frontend asset (site default, e.g. /opengraph.jpg) ──────────────
  // The api-server does not serve the synozur frontend's static files, so a
  // same-origin non-/api path is validated on disk instead of over HTTP.
  if (sameOrigin && !parsed.pathname.startsWith("/api/")) {
    const absPath = path.join(SYNOZUR_PUBLIC, parsed.pathname);
    assert.ok(
      fs.existsSync(absPath),
      `${label}: og:image resolves to static file ${parsed.pathname} but it does ` +
        `not exist in artifacts/synozur/public/ (${absPath}). The share card will be blank.`,
    );
    const meta = await sharp(absPath).metadata();
    assert.equal(
      meta.width,
      OG_WIDTH,
      `${label}: static og:image ${parsed.pathname} is ${meta.width}px wide, ` +
        `expected ${OG_WIDTH}px.`,
    );
    assert.equal(
      meta.height,
      OG_HEIGHT,
      `${label}: static og:image ${parsed.pathname} is ${meta.height}px tall, ` +
        `expected ${OG_HEIGHT}px. LinkedIn and Slack require 1200×630.`,
    );
    return;
  }

  // ── External absolute URL (editor-pasted image host) ───────────────────────
  // Can't assert our resize contract on a host we don't control; just confirm
  // it's a reachable, decodable image so the card isn't blank.
  if (!sameOrigin) {
    await fetchImage(ogImage, label);
    return;
  }

  // ── Same-origin /api/* (storage resize variant or generated OG card) ───────
  // Re-point at THIS server so the check exercises the local build, then assert
  // the canonical 1200px width and a landscape aspect.
  const localUrl = `${baseUrl}${parsed.pathname}${parsed.search}`;
  const { meta } = await fetchImage(localUrl, label);
  assert.equal(
    meta.width,
    OG_WIDTH,
    `${label}: og:image width is ${meta.width}px, expected ${OG_WIDTH}px (${ogImage}). ` +
      `Healthy share images are served at 1200px wide via the storage resize ` +
      `(?w=1200) or the generated OG card. A smaller width means the source ` +
      `upload is below 1200px (the resizer never enlarges) — replace it with a ` +
      `≥1200px image.`,
  );
  assert.ok(
    (meta.height as number) <= (meta.width as number),
    `${label}: og:image is ${meta.width}×${meta.height} (portrait) (${ogImage}). ` +
      `LinkedIn/Slack crop portrait images badly — use a landscape share image.`,
  );
}

// ─── Sample published Insights posts ───────────────────────────────────────────

const postSample = await db
  .select({ slug: postsTable.slug })
  .from(postsTable)
  .where(and(eq(postsTable.status, "published"), isNull(postsTable.deletedAt)))
  .orderBy(desc(postsTable.publishedAt))
  .limit(SAMPLE_SIZE);

if (postSample.length === 0) {
  test("published posts OG sample (no published posts in DB)", (t) => {
    t.skip("No published posts found — nothing to sample.");
  });
} else {
  for (const post of postSample) {
    test(`OG image healthy for post: ${post.slug}`, async () => {
      await assertHealthyOgImage(`/insights/${post.slug}`, `post: ${post.slug}`);
    });
  }
}

// ─── Sample upcoming Events ─────────────────────────────────────────────────────
// Upcoming (future start date) and not archived — archived events 410 at the
// API and are de-indexed, so they aren't shared.

const eventSample = await db
  .select({ slug: eventsTable.slug })
  .from(eventsTable)
  .where(
    and(gte(eventsTable.startDate, new Date()), ne(eventsTable.status, "archived")),
  )
  .orderBy(asc(eventsTable.startDate))
  .limit(SAMPLE_SIZE);

if (eventSample.length === 0) {
  test("upcoming events OG sample (no upcoming events in DB)", (t) => {
    t.skip("No upcoming events found — nothing to sample.");
  });
} else {
  for (const event of eventSample) {
    test(`OG image healthy for event: ${event.slug}`, async () => {
      await assertHealthyOgImage(`/events/${event.slug}`, `event: ${event.slug}`);
    });
  }
}
