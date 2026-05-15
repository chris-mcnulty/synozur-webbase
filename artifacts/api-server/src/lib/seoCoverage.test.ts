/**
 * #160 — index-coverage bucket normalizer regression test.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:seo-coverage
 *
 * The Search Console / Bing → bucket mapping is the only logic the admin
 * dashboard's correctness hinges on; everything else is plumbing. These
 * pure tests pin the mapping so a reworded `coverageState` or a changed
 * Bing payload can't silently mis-bucket a page (e.g. counting a
 * "Discovered — currently not indexed" URL as indexed).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGoogleBucket,
  normalizeBingBucket,
  parseMicrosoftDate,
} from "./seoCoverageBuckets";

test("google: submitted and indexed → indexed", () => {
  assert.equal(
    normalizeGoogleBucket({ verdict: "PASS", coverageState: "Submitted and indexed" }),
    "indexed",
  );
});

test("google: indexed, not submitted in sitemap → indexed", () => {
  assert.equal(
    normalizeGoogleBucket({
      verdict: "PASS",
      coverageState: "Indexed, not submitted in sitemap",
    }),
    "indexed",
  );
});

test("google: discovered - currently not indexed → discovered-not-indexed", () => {
  assert.equal(
    normalizeGoogleBucket({
      verdict: "NEUTRAL",
      coverageState: "Discovered - currently not indexed",
    }),
    "discovered-not-indexed",
  );
});

test("google: crawled - currently not indexed → discovered-not-indexed", () => {
  assert.equal(
    normalizeGoogleBucket({
      verdict: "NEUTRAL",
      coverageState: "Crawled - currently not indexed",
    }),
    "discovered-not-indexed",
  );
});

test("google: soft 404 fetch state → soft-404", () => {
  assert.equal(
    normalizeGoogleBucket({
      verdict: "FAIL",
      coverageState: "Submitted URL seems to be a Soft 404",
      pageFetchState: "SOFT_404",
    }),
    "soft-404",
  );
});

test("google: blocked by robots → crawl-error", () => {
  assert.equal(
    normalizeGoogleBucket({
      verdict: "FAIL",
      coverageState: "Blocked by robots.txt",
      robotsTxtState: "DISALLOWED",
    }),
    "crawl-error",
  );
});

test("google: fetch not found → crawl-error", () => {
  assert.equal(
    normalizeGoogleBucket({
      verdict: "FAIL",
      coverageState: "URL is unknown to Google",
      pageFetchState: "NOT_FOUND",
    }),
    "crawl-error",
  );
});

test("google: unknown coverage with successful fetch → unknown", () => {
  assert.equal(
    normalizeGoogleBucket({
      verdict: "NEUTRAL",
      coverageState: "URL is unknown to Google",
      pageFetchState: "SUCCESSFUL",
    }),
    "unknown",
  );
});

test("google: null result → unknown", () => {
  assert.equal(normalizeGoogleBucket(null), "unknown");
});

test("bing: 200 + last crawled → indexed", () => {
  assert.equal(
    normalizeBingBucket({
      HttpStatus: 200,
      LastCrawledDate: "/Date(1700000000000)/",
    }),
    "indexed",
  );
});

test("bing: discovered but never crawled → discovered-not-indexed", () => {
  assert.equal(
    normalizeBingBucket({
      HttpStatus: 200,
      DiscoveredDate: "/Date(1700000000000)/",
      LastCrawledDate: null,
    }),
    "discovered-not-indexed",
  );
});

test("bing: 404 → crawl-error", () => {
  assert.equal(normalizeBingBucket({ HttpStatus: 404 }), "crawl-error");
});

test("bing: no payload → unknown", () => {
  assert.equal(normalizeBingBucket(null), "unknown");
});

test("parseMicrosoftDate handles /Date(ms)/ and ISO", () => {
  assert.equal(
    parseMicrosoftDate("/Date(1700000000000)/")?.getTime(),
    1700000000000,
  );
  assert.equal(parseMicrosoftDate(null), null);
  const iso = parseMicrosoftDate("2026-05-15T00:00:00.000Z");
  assert.equal(iso?.toISOString(), "2026-05-15T00:00:00.000Z");
});
