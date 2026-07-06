/**
 * #160 — index-coverage bucket normalizer + aggregation tests.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:seo-coverage
 *
 * Part 1 (pure): Pin the Search Console / Bing → bucket mapping so a
 * reworded `coverageState` or changed Bing payload can't silently mis-bucket
 * a page (e.g. counting "Discovered — currently not indexed" as indexed).
 *
 * Part 2 (DB): Integration tests for `getCoverageOverview` that seed
 * `seo_coverage_status` rows and assert the aggregation is correct — in
 * particular that the Bing fallback kicks in when Google returns "error" for
 * every row and that the `googleAuthWarning` flag is raised/cleared correctly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  seoCoverageStatusTable,
  seoCoverageRunsTable,
} from "@workspace/db";
import {
  normalizeGoogleBucket,
  normalizeBingBucket,
  parseMicrosoftDate,
} from "./seoCoverageBuckets";
import { getCoverageOverview, listCoverageUrls } from "./seoCoverage.js";

// ─── Part 1: Pure bucket normalizers ─────────────────────────────────────────

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

// ─── Part 2: getCoverageOverview DB integration ───────────────────────────────
//
// Each test uses a unique URL prefix AND a unique artifactKind (built from 8
// random hex chars) so the getCoverageOverview full-table aggregation is
// fully isolated — no collision with real DB data or concurrent test runs.
// Rows are deleted in a finally block after every assertion.

function uniqueTag(): string {
  return `test-${crypto.randomBytes(4).toString("hex")}`;
}

test("getCoverageOverview: Bing fallback — byKind populated when Google is all errors", async () => {
  const tag = uniqueTag();
  const kindA = `${tag}-insight`;
  const kindB = `${tag}-service`;
  const urls = [
    `https://${tag}.invalid/a`,
    `https://${tag}.invalid/b`,
    `https://${tag}.invalid/x`,
  ];

  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[0],
      path: "/a",
      artifactKind: kindA,
      googleBucket: "error",
      bingBucket: "indexed",
      lastCheckedAt: new Date(),
    },
    {
      url: urls[1],
      path: "/b",
      artifactKind: kindA,
      googleBucket: "error",
      bingBucket: "discovered-not-indexed",
      lastCheckedAt: new Date(),
    },
    {
      url: urls[2],
      path: "/x",
      artifactKind: kindB,
      googleBucket: "error",
      bingBucket: "crawl-error",
      lastCheckedAt: new Date(),
    },
  ]);

  try {
    const overview = await getCoverageOverview();

    const kindARow = overview.byKind.find((k) => k.kind === kindA);
    const kindBRow = overview.byKind.find((k) => k.kind === kindB);

    assert.ok(kindARow, "byKind must include the insight-like kind via Bing fallback");
    assert.equal(kindARow.total, 2, "total should be 2");
    assert.equal(kindARow.indexed, 1, "indexed should be 1 (from Bing)");
    assert.equal(kindARow.discoveredNotIndexed, 1, "discoveredNotIndexed should be 1 (from Bing)");

    assert.ok(kindBRow, "byKind must include the service-like kind via Bing fallback");
    assert.equal(kindBRow.total, 1, "total should be 1");
    assert.equal(kindBRow.crawlError, 1, "crawlError should be 1 (from Bing)");
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

test("getCoverageOverview: Google bucket preferred when valid, Bing ignored", async () => {
  const tag = uniqueTag();
  const kind = `${tag}-solution`;
  const urls = [`https://${tag}.invalid/alpha`];

  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[0],
      path: "/alpha",
      artifactKind: kind,
      googleBucket: "indexed",
      bingBucket: "discovered-not-indexed",
      lastCheckedAt: new Date(),
    },
  ]);

  try {
    const overview = await getCoverageOverview();
    const row = overview.byKind.find((k) => k.kind === kind);

    assert.ok(row, "unique kind must appear in byKind");
    assert.equal(row.total, 1, "total should be 1");
    assert.equal(row.indexed, 1, "Google-indexed wins over Bing discovered-not-indexed");
    assert.equal(row.discoveredNotIndexed, 0, "Bing bucket must not override valid Google bucket");
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

test("getCoverageOverview: rows with no valid bucket from either provider are excluded", async () => {
  const tag = uniqueTag();
  const kind = `${tag}-ghost`;
  const urls = [`https://${tag}.invalid/ghost`];

  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[0],
      path: "/ghost",
      artifactKind: kind,
      googleBucket: "error",
      bingBucket: "not-configured",
      lastCheckedAt: new Date(),
    },
  ]);

  try {
    const overview = await getCoverageOverview();
    const row = overview.byKind.find((k) => k.kind === kind);

    assert.equal(
      row,
      undefined,
      "a kind whose only row has no valid bucket from either provider must not appear in byKind",
    );
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

// ─── googleAuthWarning flag ───────────────────────────────────────────────────

test("getCoverageOverview: googleAuthWarning=true when googleConfigured and googleChecked=0 and urlCount>0", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 10,
      googleConfigured: true,
      bingConfigured: false,
      googleChecked: 0,
      bingChecked: 0,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.googleAuthWarning,
      true,
      "googleAuthWarning must be true when Google is configured but returned 0 successful probes",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [run.id]));
  }
});

test("getCoverageOverview: googleAuthWarning=false when googleChecked>0", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 10,
      googleConfigured: true,
      bingConfigured: false,
      googleChecked: 8,
      bingChecked: 0,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.googleAuthWarning,
      false,
      "googleAuthWarning must be false when Google returned successful probes",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [run.id]));
  }
});

test("getCoverageOverview: googleAuthWarning=false when googleConfigured=false", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 5,
      googleConfigured: false,
      bingConfigured: true,
      googleChecked: 0,
      bingChecked: 5,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.googleAuthWarning,
      false,
      "googleAuthWarning must be false when Google is not configured",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [run.id]));
  }
});

// ─── Part 3: listCoverageUrls drill-down filter ───────────────────────────────
//
// Verifies the OR condition that lets the Bing bucket act as a fallback when
// the Google bucket is null or not a recognised valid value (e.g. "error").

test("listCoverageUrls: Google-only row is returned when querying its Google bucket", async () => {
  const tag = uniqueTag();
  const kind = `${tag}-kind`;
  const urls = [`https://${tag}.invalid/g-only`];

  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[0],
      path: "/g-only",
      artifactKind: kind,
      googleBucket: "indexed",
      bingBucket: "discovered-not-indexed",
      lastCheckedAt: new Date(),
    },
  ]);

  try {
    const rows = await listCoverageUrls({ kind, bucket: "indexed", limit: 100 });
    const found = rows.find((r) => r.url === urls[0]);
    assert.ok(found, "row with googleBucket=indexed must be returned when querying bucket=indexed");
    assert.equal(found.googleBucket, "indexed");
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

test("listCoverageUrls: Bing-fallback row (googleBucket=error) is returned when querying its Bing bucket", async () => {
  const tag = uniqueTag();
  const kind = `${tag}-kind`;
  const urls = [`https://${tag}.invalid/bing-fallback`];

  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[0],
      path: "/bing-fallback",
      artifactKind: kind,
      googleBucket: "error",
      bingBucket: "indexed",
      lastCheckedAt: new Date(),
    },
  ]);

  try {
    const rows = await listCoverageUrls({ kind, bucket: "indexed", limit: 100 });
    const found = rows.find((r) => r.url === urls[0]);
    assert.ok(
      found,
      "row with googleBucket=error and bingBucket=indexed must be returned when querying bucket=indexed (Bing fallback)",
    );
    assert.equal(found.googleBucket, "error");
    assert.equal(found.bingBucket, "indexed");
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

test("listCoverageUrls: row with valid Google verdict is NOT returned when querying a Bing bucket it does not match", async () => {
  const tag = uniqueTag();
  const kind = `${tag}-kind`;
  const urls = [`https://${tag}.invalid/google-wins`];

  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[0],
      path: "/google-wins",
      artifactKind: kind,
      googleBucket: "indexed",
      bingBucket: "discovered-not-indexed",
      lastCheckedAt: new Date(),
    },
  ]);

  try {
    const rows = await listCoverageUrls({ kind, bucket: "discovered-not-indexed", limit: 100 });
    assert.equal(
      rows.length,
      0,
      "row with valid googleBucket=indexed must NOT appear when querying bucket=discovered-not-indexed, even though its bingBucket matches",
    );
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

// ─── Teardown ─────────────────────────────────────────────────────────────────

test.after(async () => {
  await pool.end();
});
