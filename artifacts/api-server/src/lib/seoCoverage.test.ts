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
import { and, desc, eq, gte, inArray } from "drizzle-orm";
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
import {
  getCoverageOverview,
  listRecentRuns,
  listCoverageUrls,
  probeBing,
  createBingProbeQueue,
  runSeoCoverageScan,
  startSeoCoverageScan,
  __setBingProbeForTesting,
  __setEntriesForTesting,
  __setSubmitUrlsForTesting,
  __setBypassAdvisoryLockForTesting,
  __markActiveScanStalledForTesting,
  __setGoogleClientFactoryForTesting,
  normalizedGoogleSiteUrl,
  buildProviderIndexingTrend,
} from "./seoCoverage.js";
import type { SubmitBundle, SubmitOptions } from "./seoSubmit.js";
import { siteOrigin } from "./siteOrigin.js";

// ─── normalizedGoogleSiteUrl ─────────────────────────────────────────────────
// URL-prefix Search Console properties are registered WITH a trailing slash;
// the URL Inspection API rejects a slash-less siteUrl with "You do not own
// this site". Pin the normalization so the env var can't silently break scans.

test("siteUrl: url-prefix without trailing slash gets one appended", () => {
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = "https://www.example.com";
  assert.equal(normalizedGoogleSiteUrl(), "https://www.example.com/");
});

test("siteUrl: url-prefix with trailing slash passes through", () => {
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = "https://www.example.com/";
  assert.equal(normalizedGoogleSiteUrl(), "https://www.example.com/");
});

test("siteUrl: sc-domain property passes through unchanged", () => {
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = "sc-domain:example.com";
  assert.equal(normalizedGoogleSiteUrl(), "sc-domain:example.com");
});

test("siteUrl: whitespace trimmed, empty stays empty", () => {
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = "  https://a.example  ";
  assert.equal(normalizedGoogleSiteUrl(), "https://a.example/");
  delete process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
  assert.equal(normalizedGoogleSiteUrl(), "");
});

test("indexing trend: Google ETA waits for seven consecutive positive daily changes", () => {
  const snapshots = Array.from({ length: 8 }, (_, index) => ({
    snapshotDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    sitemapUrlCount: 200,
    checkedUrlCount: 200,
    indexedUrlCount: 100 + index,
    discoveredNotIndexedCount: 100 - index,
    isComplete: true,
  }));
  const trend = buildProviderIndexingTrend(
    "google",
    snapshots,
    new Map([["2026-08-08", 1]]),
  );
  assert.equal(trend.latestNetIndexedChange, 1);
  assert.equal(trend.averageNetNewPerDay, 1);
  assert.equal(trend.projectedDaysToFullIndex, 93);
  assert.equal(trend.days.at(-1)?.confirmedNewlyIndexed, 1);

  const notEnoughData = buildProviderIndexingTrend(
    "google",
    snapshots.slice(0, 7),
    new Map(),
  );
  assert.equal(notEnoughData.projectedDaysToFullIndex, null);
});

test("indexing trend: Google ETA rejects gaps, partial days, and non-positive movement", () => {
  const snapshots = Array.from({ length: 8 }, (_, index) => ({
    snapshotDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    sitemapUrlCount: 200,
    checkedUrlCount: 200,
    indexedUrlCount: 100 + index,
    discoveredNotIndexedCount: 100 - index,
    isComplete: true,
  }));
  const withGap = [...snapshots];
  withGap[4] = { ...withGap[4]!, snapshotDate: "2026-08-07" };
  assert.equal(
    buildProviderIndexingTrend("google", withGap, new Map())
      .projectedDaysToFullIndex,
    null,
  );

  const withPartialDay = [...snapshots];
  withPartialDay[4] = { ...withPartialDay[4]!, isComplete: false };
  assert.equal(
    buildProviderIndexingTrend("google", withPartialDay, new Map())
      .projectedDaysToFullIndex,
    null,
  );

  const withFlatMovement = [...snapshots];
  withFlatMovement[5] = {
    ...withFlatMovement[5]!,
    indexedUrlCount: withFlatMovement[4]!.indexedUrlCount,
  };
  assert.equal(
    buildProviderIndexingTrend("google", withFlatMovement, new Map())
      .projectedDaysToFullIndex,
    null,
  );
});

test("indexing trend: Bing shows a verification rotation, never a sitewide ETA", () => {
  const trend = buildProviderIndexingTrend(
    "bing",
    [
      {
        snapshotDate: "2026-08-01",
        sitemapUrlCount: 383,
        checkedUrlCount: 16,
        indexedUrlCount: 163,
        discoveredNotIndexedCount: 0,
        isComplete: false,
      },
      {
        snapshotDate: "2026-08-02",
        sitemapUrlCount: 383,
        checkedUrlCount: 20,
        indexedUrlCount: 170,
        discoveredNotIndexedCount: 1,
        isComplete: false,
      },
    ],
    new Map([["2026-08-02", 2]]),
  );
  assert.equal(trend.projectedDaysToFullIndex, null);
  assert.equal(trend.estimatedDaysForFullRecheck, 22);
  assert.equal(trend.days.at(-1)?.confirmedNewlyIndexed, 2);
});

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

// ─── Part 1b: Bing probe error categorization ────────────────────────────────
//
// Bing signals rate limiting as HTTP 400 with
// `{"ErrorCode":5,"Message":"ERROR!!! ThrottleHost"}` (confirmed against the
// live API) rather than a conventional 429. Throttled probes must be
// categorized as "not-checked" (retryable, not a real failure) so rate
// limiting never lands URLs in the error bucket.

async function withMockFetch<T>(
  responder: () => Response,
  fn: () => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => responder()) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const BING_ENV = { BING_API_KEY: "test-key", BING_SITE_URL: "https://example.com/" };
async function withBingEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = {
    BING_API_KEY: process.env.BING_API_KEY,
    BING_SITE_URL: process.env.BING_SITE_URL,
  };
  Object.assign(process.env, BING_ENV);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("probeBing: HTTP 400 ThrottleHost → not-checked + throttled", async () => {
  const probe = await withBingEnv(() =>
    withMockFetch(
      () =>
        new Response('{"ErrorCode":5,"Message":"ERROR!!! ThrottleHost"}', {
          status: 400,
        }),
      () => probeBing("https://example.com/page"),
    ),
  );
  assert.equal(probe.bucket, "not-checked");
  assert.equal(probe.throttled, true);
  const raw = probe.raw as { httpStatus: number; errorCode: number | null; message: string | null };
  assert.equal(raw.httpStatus, 400);
  assert.equal(raw.errorCode, 5);
  assert.match(raw.message ?? "", /ThrottleHost/);
});

test("probeBing: HTTP 429 → not-checked + throttled", async () => {
  const probe = await withBingEnv(() =>
    withMockFetch(
      () => new Response("slow down", { status: 429 }),
      () => probeBing("https://example.com/page"),
    ),
  );
  assert.equal(probe.bucket, "not-checked");
  assert.equal(probe.throttled, true);
});

test("probeBing: non-throttle HTTP 400 → error (not throttled)", async () => {
  const probe = await withBingEnv(() =>
    withMockFetch(
      () =>
        new Response('{"ErrorCode":2,"Message":"ERROR!!! InvalidUrl"}', {
          status: 400,
        }),
      () => probeBing("https://example.com/page"),
    ),
  );
  assert.equal(probe.bucket, "error");
  assert.equal(probe.throttled, false);
  const raw = probe.raw as { errorCode: number | null; message: string | null };
  assert.equal(raw.errorCode, 2);
  assert.match(raw.message ?? "", /InvalidUrl/);
});

test("probeBing: successful 200 payload → indexed, not throttled", async () => {
  const probe = await withBingEnv(() =>
    withMockFetch(
      () =>
        new Response(
          JSON.stringify({
            d: { HttpStatus: 200, LastCrawledDate: "/Date(1700000000000)/" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      () => probeBing("https://example.com/page"),
    ),
  );
  assert.equal(probe.bucket, "indexed");
  assert.equal(probe.throttled, false);
});

// ─── Part 1c: throttle stops the queue before the network call ───────────────

test("createBingProbeQueue: after one throttle, no further probes hit the network", async () => {
  let calls = 0;
  const queue = createBingProbeQueue({
    delayMs: 0,
    probe: async () => {
      calls += 1;
      return {
        bucket: "not-checked",
        httpStatus: null,
        lastCrawlAt: null,
        raw: { httpStatus: 400, message: "ERROR!!! ThrottleHost" },
        throttled: true,
      };
    },
  });
  // Enqueue 5 probes concurrently (like SCAN_CONCURRENCY workers racing):
  // only the first may reach the probe fn; the rest must short-circuit.
  const results = await Promise.all(
    ["a", "b", "c", "d", "e"].map((p) =>
      queue.enqueue(`https://example.com/${p}`),
    ),
  );
  assert.equal(calls, 1, "only the first probe may hit the network");
  assert.equal(results[0].skippedThrottled, false);
  for (const r of results.slice(1)) {
    assert.equal(r.throttled, true);
    assert.equal(r.skippedThrottled, true);
    assert.equal(r.bucket, "not-checked");
  }
  assert.equal(queue.isThrottled(), true);
});

test("createBingProbeQueue: non-throttled probes all go through", async () => {
  let calls = 0;
  const queue = createBingProbeQueue({
    delayMs: 0,
    probe: async () => {
      calls += 1;
      return {
        bucket: "indexed",
        httpStatus: 200,
        lastCrawlAt: new Date(),
        raw: {},
        throttled: false,
      };
    },
  });
  await Promise.all(
    ["a", "b", "c"].map((p) => queue.enqueue(`https://example.com/${p}`)),
  );
  assert.equal(calls, 3);
  assert.equal(queue.isThrottled(), false);
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

test("getCoverageOverview: rows with no valid bucket remain in sitemap inventory as pending", async () => {
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

    assert.ok(row, "a sitemap kind must remain visible without a provider verdict");
    assert.equal(row.total, 1, "inventory total must include the URL");
    assert.equal(row.inspected, 0, "no usable provider result was returned");
    assert.equal(row.pendingInspection, 1, "the URL must be marked pending inspection");
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

test("listRecentRuns: unfinished runs expose completed URL progress and a recovery state", async () => {
  const startedAt = new Date(Date.now() - 30_000);
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      startedAt,
      trigger: "manual",
      urlCount: 4,
      googleConfigured: true,
      bingConfigured: false,
      completedUrlCount: 1,
      lastProgressAt: new Date(),
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const runs = await listRecentRuns(50);
    const summary = runs.find((candidate) => candidate.id === run.id);
    assert.ok(summary, "the unfinished run should appear in history");
    assert.deepEqual(summary.progress && {
      state: summary.progress.state,
      completedUrlCount: summary.progress.completedUrlCount,
      totalUrlCount: summary.progress.totalUrlCount,
    }, {
      state: "running",
      completedUrlCount: 1,
      totalUrlCount: 4,
    });
    assert.ok(summary.progress?.lastProgressAt, "latest completed URL timestamp is exposed");

    await db
      .update(seoCoverageRunsTable)
      .set({ lastProgressAt: new Date(Date.now() - 3 * 60 * 1000) })
      .where(eq(seoCoverageRunsTable.id, run.id));
    const recoveredRuns = await listRecentRuns(50);
    assert.equal(
      recoveredRuns.find((candidate) => candidate.id === run.id)?.progress?.state,
      "stalled",
      "an abandoned heartbeat must switch the dashboard to recovery state",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(eq(seoCoverageRunsTable.id, run.id));
  }
});

// ─── googleAuthWarning flag ───────────────────────────────────────────────────

test("getCoverageOverview: googleAuthWarning=true when a finished configured run checked 0 URLs", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      finishedAt: new Date(),
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

test("getCoverageOverview: googleAuthWarning=false while a configured scan is still running", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 10,
      googleConfigured: true,
      bingConfigured: false,
      googleChecked: 0,
      bingChecked: 0,
      completedUrlCount: 4,
      lastProgressAt: new Date(),
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.googleAuthWarning,
      false,
      "an in-progress scan's temporary zero counter must not be treated as an auth failure",
    );
    assert.equal(overview.scanRunning, true);
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(eq(seoCoverageRunsTable.id, run.id));
  }
});

test("getCoverageOverview: googleAuthWarning=false when googleChecked>0", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      finishedAt: new Date(),
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
      finishedAt: new Date(),
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

// ─── bingThrottleWarning flag ─────────────────────────────────────────────────

test("getCoverageOverview: bingThrottleWarning=true only when the run records an actual Bing throttle", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 10,
      googleConfigured: false,
      bingConfigured: true,
      googleChecked: 0,
      bingChecked: 0,
      bingThrottled: true,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.bingThrottleWarning,
      true,
      "bingThrottleWarning must follow the explicit Bing throttle result",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [run.id]));
  }
});

test("getCoverageOverview: bingThrottleWarning=false when zero Bing checks were not a throttle", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 10,
      googleConfigured: false,
      bingConfigured: true,
      googleChecked: 0,
      bingChecked: 0,
      bingThrottled: false,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.bingThrottleWarning,
      false,
      "auth, InvalidUrl, and other provider failures must not be labelled as throttling",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [run.id]));
  }
});

test("getCoverageOverview: bingThrottleWarning=false when bingConfigured=false", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 5,
      googleConfigured: true,
      bingConfigured: false,
      googleChecked: 5,
      bingChecked: 0,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.bingThrottleWarning,
      false,
      "bingThrottleWarning must be false when Bing is not configured",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [run.id]));
  }
});

test("getCoverageOverview: bingThrottleWarning=false when urlCount=0", async () => {
  const [run] = await db
    .insert(seoCoverageRunsTable)
    .values({
      trigger: "manual",
      urlCount: 0,
      googleConfigured: false,
      bingConfigured: true,
      googleChecked: 0,
      bingChecked: 0,
      bingThrottled: false,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overview = await getCoverageOverview();
    assert.equal(
      overview.bingThrottleWarning,
      false,
      "bingThrottleWarning must be false when urlCount=0 (nothing was scanned)",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [run.id]));
  }
});

// Cross-scan transition: warning raised by a throttled run must clear once a
// later run with bingChecked>0 becomes the newest record.
test("getCoverageOverview: bingThrottleWarning clears when a later run has bingChecked>0", async () => {
  const now = Date.now();
  // Use timestamps relative to wall-clock to guarantee ordering regardless of
  // when the tests run.
  const earlier = new Date(now - 60_000); // 1 minute ago
  const later = new Date(now + 60_000);   // 1 minute from now

  const [throttledRun] = await db
    .insert(seoCoverageRunsTable)
    .values({
      startedAt: earlier,
      trigger: "scheduled",
      urlCount: 10,
      googleConfigured: false,
      bingConfigured: true,
      googleChecked: 0,
      bingChecked: 0,
      bingThrottled: true,
    })
    .returning({ id: seoCoverageRunsTable.id });

  // Verify warning is true after only the throttled run exists.
  const overviewAfterThrottle = await getCoverageOverview();
  assert.equal(
    overviewAfterThrottle.bingThrottleWarning,
    true,
    "bingThrottleWarning must be true after a throttled run with bingChecked=0",
  );

  const [successfulRun] = await db
    .insert(seoCoverageRunsTable)
    .values({
      startedAt: later,
      trigger: "scheduled",
      urlCount: 10,
      googleConfigured: false,
      bingConfigured: true,
      googleChecked: 0,
      bingChecked: 7,
      bingThrottled: false,
    })
    .returning({ id: seoCoverageRunsTable.id });

  try {
    const overviewAfterSuccess = await getCoverageOverview();
    assert.equal(
      overviewAfterSuccess.bingThrottleWarning,
      false,
      "bingThrottleWarning must clear once a later run with bingChecked>0 is the newest record",
    );
    assert.equal(
      overviewAfterSuccess.lastRun?.id,
      successfulRun.id,
      "lastRun must be the later (successful) run, not the throttled one",
    );
  } finally {
    await db
      .delete(seoCoverageRunsTable)
      .where(inArray(seoCoverageRunsTable.id, [throttledRun.id, successfulRun.id]));
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

test("listCoverageUrls: pending inspection returns URLs without a usable provider verdict", async () => {
  const tag = uniqueTag();
  const kind = `${tag}-kind`;
  const urls = [
    `https://${tag}.invalid/google-quota`,
    `https://${tag}.invalid/bing-throttled`,
  ];

  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[0],
      path: "/google-quota",
      artifactKind: kind,
      googleBucket: "error",
      googleRaw: {
        error: "Quota exceeded for quota metric 'URL Inspection API requests'",
        classification: "quota-exhausted",
      },
      bingBucket: "not-checked",
      bingRaw: { skipped: "bing-throttled" },
      lastCheckedAt: new Date(),
    },
    {
      url: urls[1],
      path: "/bing-throttled",
      artifactKind: kind,
      googleBucket: "error",
      bingBucket: "not-checked",
      bingRaw: { throttled: true, message: "ERROR!!! ThrottleHost" },
      lastCheckedAt: new Date(),
    },
  ]);

  try {
    const rows = await listCoverageUrls({
      kind,
      bucket: "pending-inspection",
      limit: 100,
    });
    assert.deepEqual(
      rows.map((row) => row.url).sort(),
      [...urls].sort(),
      "quota and throttled rows must remain available from the pending drill-down",
    );
  } finally {
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
  }
});

// ─── Parts 4 & 5: runSeoCoverageScan integration (serial) ─────────────────────
//
// All tests that call runSeoCoverageScan() share an in-process `scanRunning`
// flag and a Postgres advisory lock, so they MUST run serially. They live as
// subtests of a single parent test — Node's test runner always runs `await
// t.test(...)` calls one at a time within a parent, regardless of the
// top-level concurrency setting.

// Helpers shared across scan subtests.
function saveScanEnv() {
  return {
    BING_API_KEY: process.env.BING_API_KEY,
    BING_SITE_URL: process.env.BING_SITE_URL,
    GOOGLE_INDEXING_SA_JSON: process.env.GOOGLE_INDEXING_SA_JSON,
    GOOGLE_SEARCH_CONSOLE_SITE_URL: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL,
    BING_PROBE_DELAY_MS: process.env.BING_PROBE_DELAY_MS,
    SEO_COVERAGE_MAX_URLS: process.env.SEO_COVERAGE_MAX_URLS,
    SEO_COVERAGE_RESUBMISSION_TIMEOUT_MS:
      process.env.SEO_COVERAGE_RESUBMISSION_TIMEOUT_MS,
  };
}
function restoreScanEnv(saved: ReturnType<typeof saveScanEnv>) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k as keyof typeof saved];
    else process.env[k as keyof typeof saved] = v;
  }
}
function setupBingOnlyEnv() {
  process.env.BING_API_KEY = "test-key";
  process.env.BING_SITE_URL = "https://example.com/";
  delete process.env.GOOGLE_INDEXING_SA_JSON;
  delete process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
  process.env.BING_PROBE_DELAY_MS = "0";
}
function setupGoogleOnlyEnv() {
  // Minimal SA JSON that satisfies googleConfigured() — the factory is
  // replaced by __setGoogleClientFactoryForTesting so the SA is never parsed.
  process.env.GOOGLE_INDEXING_SA_JSON = JSON.stringify({ client_email: "sa@test.iam.gserviceaccount.com" });
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = "https://example.com/";
  delete process.env.BING_API_KEY;
  delete process.env.BING_SITE_URL;
  process.env.BING_PROBE_DELAY_MS = "0";
}
function setupGoogleAndBingEnv() {
  process.env.GOOGLE_INDEXING_SA_JSON = JSON.stringify({ client_email: "sa@test.iam.gserviceaccount.com" });
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = "https://example.com/";
  process.env.BING_API_KEY = "test-key";
  process.env.BING_SITE_URL = "https://example.com/";
  process.env.BING_PROBE_DELAY_MS = "0";
}

test("runSeoCoverageScan integration", async (t) => {
  // Bypass the Postgres advisory lock for the duration of this parent test.
  // The lock is session-level: acquire and release can land on different pool
  // connections, leaving it permanently held after the first subtest.
  // The in-memory scanRunning flag provides the same single-process guard,
  // and the subtests already run serially via `await t.test(...)`.
  __setBypassAdvisoryLockForTesting(true);
  t.after(() => __setBypassAdvisoryLockForTesting(false));

// ─── Part 4: throttle behavior ───────────────────────────────────────────────

  await t.test("first throttle stops probing, preserves verdicts, relabels errors", async () => {
  const tag = uniqueTag();
  const urls = [
    `https://${tag}.invalid/fresh`, // new row, never seen
    `https://${tag}.invalid/good`, // has a prior successful verdict
    `https://${tag}.invalid/err`, // stuck in the legacy error bucket
    `https://${tag}.invalid/real-err`, // a genuine (non-throttle) failure
  ];
  const oldCheckedAt = new Date("2026-01-01T00:00:00Z");

  // Seed prior state: /good was successfully checked before, /err carries
  // legacy throttle noise. Rotation should therefore probe /fresh or /err
  // (never-checked) before /good.
  await db.insert(seoCoverageStatusTable).values([
    {
      url: urls[1],
      path: "/good",
      artifactKind: `${tag}-kind`,
      bingBucket: "indexed",
      bingHttpStatus: 200,
      bingCheckedAt: oldCheckedAt,
      lastCheckedAt: oldCheckedAt,
    },
    {
      url: urls[2],
      path: "/err",
      artifactKind: `${tag}-kind`,
      bingBucket: "error",
      bingRaw: { httpStatus: 400 },
      lastCheckedAt: oldCheckedAt,
    },
    {
      url: urls[3],
      path: "/real-err",
      artifactKind: `${tag}-kind`,
      bingBucket: "error",
      bingRaw: { httpStatus: 400, errorCode: 2, message: "ERROR!!! InvalidUrl" },
      lastCheckedAt: oldCheckedAt,
    },
  ]);

  const prevEnv = {
    BING_API_KEY: process.env.BING_API_KEY,
    BING_SITE_URL: process.env.BING_SITE_URL,
    GOOGLE_INDEXING_SA_JSON: process.env.GOOGLE_INDEXING_SA_JSON,
    GOOGLE_SEARCH_CONSOLE_SITE_URL: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL,
    BING_PROBE_DELAY_MS: process.env.BING_PROBE_DELAY_MS,
    SEO_COVERAGE_MAX_URLS: process.env.SEO_COVERAGE_MAX_URLS,
    SEO_COVERAGE_RESUBMISSION_TIMEOUT_MS:
      process.env.SEO_COVERAGE_RESUBMISSION_TIMEOUT_MS,
  };
  process.env.BING_API_KEY = "test-key";
  process.env.BING_SITE_URL = "https://example.com/";
  delete process.env.GOOGLE_INDEXING_SA_JSON; // keep Google out of this test
  delete process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
  process.env.BING_PROBE_DELAY_MS = "0";

  let probeCalls = 0;
  __setBingProbeForTesting(async () => {
    probeCalls += 1;
    return {
      bucket: "not-checked",
      httpStatus: null,
      lastCrawlAt: null,
      raw: { httpStatus: 400, errorCode: 5, message: "ERROR!!! ThrottleHost", throttled: true },
      throttled: true,
    };
  });
  __setEntriesForTesting(async () => urls);

  const scanStart = new Date();
  try {
    const result = await runSeoCoverageScan("manual");
    assert.equal(result.skipped, false);
    assert.equal(result.urlCount, 4);
    assert.equal(result.bingChecked, 0);
    assert.equal(probeCalls, 1, "after the first throttle, no further probes may run");

    const rows = await db
      .select({
        url: seoCoverageStatusTable.url,
        bingBucket: seoCoverageStatusTable.bingBucket,
        bingHttpStatus: seoCoverageStatusTable.bingHttpStatus,
      })
      .from(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
    const byUrl = new Map(rows.map((r) => [r.url, r]));

    assert.equal(
      byUrl.get(urls[0])?.bingBucket,
      "not-checked",
      "brand-new row must be labelled not-checked, not error",
    );
    assert.equal(
      byUrl.get(urls[1])?.bingBucket,
      "indexed",
      "previously stored verdict must never be overwritten by throttle noise",
    );
    assert.equal(byUrl.get(urls[1])?.bingHttpStatus, 200);
    assert.equal(
      byUrl.get(urls[2])?.bingBucket,
      "not-checked",
      "legacy error rows must be relabelled not-checked when skipped",
    );
    assert.equal(
      byUrl.get(urls[3])?.bingBucket,
      "error",
      "genuine (non-throttle) errors must keep their error bucket after an unrelated throttle",
    );
  } finally {
    __setBingProbeForTesting(null);
    __setEntriesForTesting(null);
    restoreScanEnv(prevEnv);
    await db
      .delete(seoCoverageStatusTable)
      .where(inArray(seoCoverageStatusTable.url, urls));
    await db
      .delete(seoCoverageRunsTable)
      .where(
        and(
          eq(seoCoverageRunsTable.trigger, "manual"),
          gte(seoCoverageRunsTable.startedAt, scanStart),
        ),
      );
  }
  }); // end throttle subtest

  await t.test("Google quota plus partial Bing results retains every sitemap kind as confirmed or pending", async () => {
    const tag = uniqueTag();
    const origin = siteOrigin();
    const urls = [
      `${origin}/polaris/${tag}-episode`,
      `${origin}/faq/${tag}-category`,
      `${origin}/library/${tag}-item`,
      `${origin}/insights/${tag}-post`,
    ];
    const quotaDiagnostic =
      "Quota exceeded for quota metric 'URL Inspection API requests' and limit 'URL Inspection API requests per day'";
    let bingProbeCalls = 0;

    __setGoogleClientFactoryForTesting(async () => ({
      request: async () => {
        throw new Error(quotaDiagnostic);
      },
    }) as never);
    __setBingProbeForTesting(async () => {
      bingProbeCalls += 1;
      if (bingProbeCalls === 1) {
        return {
          bucket: "indexed",
          httpStatus: 200,
          lastCrawlAt: new Date(),
          raw: {},
          throttled: false,
        };
      }
      return {
        bucket: "not-checked",
        httpStatus: null,
        lastCrawlAt: null,
        raw: {
          httpStatus: 400,
          errorCode: 5,
          message: "ERROR!!! ThrottleHost",
          throttled: true,
        },
        throttled: true,
      };
    });
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupGoogleAndBingEnv();
    const scanStart = new Date();
    try {
      const before = new Map(
        (await getCoverageOverview()).byKind.map((row) => [row.kind, row]),
      );
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.skipped, false);
      assert.equal(result.urlCount, urls.length);
      assert.equal(result.googleChecked, 0);
      assert.equal(result.bingChecked, 1);
      assert.equal(bingProbeCalls, 2, "Bing stops after its first throttle");

      const overview = await getCoverageOverview();
      assert.equal(
        overview.googleQuotaWarning,
        true,
        "a Google quota diagnostic must be surfaced as a quota limitation",
      );
      assert.equal(
        overview.googleAuthWarning,
        false,
        "quota exhaustion must not be described as a credential failure",
      );
      assert.match(overview.googleLastError ?? "", /quota/i);
      assert.equal(overview.bingThrottleWarning, true);

      const scannedRows = await db
        .select({
          url: seoCoverageStatusTable.url,
          artifactKind: seoCoverageStatusTable.artifactKind,
          googleBucket: seoCoverageStatusTable.googleBucket,
          bingBucket: seoCoverageStatusTable.bingBucket,
        })
        .from(seoCoverageStatusTable)
        .where(inArray(seoCoverageStatusTable.url, urls));
      assert.equal(scannedRows.length, urls.length);
      assert.deepEqual(
        new Set(scannedRows.map((row) => row.artifactKind)),
        new Set(["polaris", "faq", "library", "insight"]),
        "the mocked sitemap must cover the four target artifact types",
      );

      const expectedByKind = new Map<string, { indexed: number; pending: number }>();
      const pendingUrls = new Set<string>();
      for (const scanned of scannedRows) {
        assert.equal(scanned.googleBucket, "error");
        const counts = expectedByKind.get(scanned.artifactKind) ?? {
          indexed: 0,
          pending: 0,
        };
        if (scanned.bingBucket === "indexed") {
          counts.indexed += 1;
        } else {
          assert.equal(
            scanned.bingBucket,
            "not-checked",
            "a throttled Bing URL must be persisted as pending, not an error",
          );
          counts.pending += 1;
          pendingUrls.add(scanned.url);
        }
        expectedByKind.set(scanned.artifactKind, counts);
      }
      assert.equal(
        [...expectedByKind.values()].reduce((sum, counts) => sum + counts.indexed, 0),
        1,
        "the partial Bing scan must leave exactly one confirmed verdict",
      );

      for (const [kind, counts] of expectedByKind) {
        const row = overview.byKind.find((candidate) => candidate.kind === kind);
        assert.ok(row, `${kind} must remain represented in sitemap inventory`);
        const prior = before.get(kind);
        assert.equal(
          row.total,
          (prior?.total ?? 0) + 1,
          `${kind} sitemap total must retain the newly scanned URL`,
        );
        assert.equal(
          row.indexed,
          (prior?.indexed ?? 0) + counts.indexed,
          `${kind} confirmed count`,
        );
        assert.equal(
          row.pendingInspection,
          (prior?.pendingInspection ?? 0) + counts.pending,
          `${kind} must be labelled pending when neither provider returned a verdict`,
        );
      }

      for (const scanned of scannedRows) {
        if (!pendingUrls.has(scanned.url)) continue;
        const pendingRows = await listCoverageUrls({
          kind: scanned.artifactKind,
          bucket: "pending-inspection",
          limit: 500,
        });
        assert.ok(
          pendingRows.some((row) => row.url === scanned.url),
          `${scanned.url} must appear in its artifact's pending drill-down`,
        );
      }
    } finally {
      __setGoogleClientFactoryForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db
        .delete(seoCoverageStatusTable)
        .where(inArray(seoCoverageStatusTable.url, urls));
      await db
        .delete(seoCoverageRunsTable)
        .where(
          and(
            eq(seoCoverageRunsTable.trigger, "manual"),
            gte(seoCoverageRunsTable.startedAt, scanStart),
          ),
        );
    }
  });

  await t.test("provider cap retains every sitemap URL as pending inventory", async () => {
    const tag = uniqueTag();
    const origin = siteOrigin();
    const urls = [
      `${origin}/polaris/${tag}`,
      `${origin}/faq/${tag}`,
      `${origin}/library/${tag}`,
      `${origin}/insights/${tag}`,
      `${origin}/insights/${tag}-second`,
    ];
    __setEntriesForTesting(async () => urls);

    const previous = saveScanEnv();
    delete process.env.GOOGLE_INDEXING_SA_JSON;
    delete process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
    delete process.env.BING_API_KEY;
    delete process.env.BING_SITE_URL;
    process.env.SEO_COVERAGE_MAX_URLS = "2";
    const scanStart = new Date();
    try {
      const before = new Map(
        (await getCoverageOverview()).byKind.map((row) => [row.kind, row]),
      );
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.urlCount, urls.length, "run total must report full sitemap inventory");

      const rows = await db
        .select({
          url: seoCoverageStatusTable.url,
          kind: seoCoverageStatusTable.artifactKind,
          lastSeenAt: seoCoverageStatusTable.lastSeenAt,
          lastCheckedAt: seoCoverageStatusTable.lastCheckedAt,
        })
        .from(seoCoverageStatusTable)
        .where(inArray(seoCoverageStatusTable.url, urls));
      assert.equal(rows.length, urls.length, "over-cap URLs must not be dropped from inventory");
      assert.equal(
        rows.filter((row) => row.lastCheckedAt !== null).length,
        2,
        "only the capped provider queue is marked as inspected",
      );
      assert.ok(
        rows.every((row) => row.lastSeenAt !== null),
        "every current sitemap URL must be marked as seen",
      );

      const overview = await getCoverageOverview();
      const additionsByKind = new Map<string, number>();
      for (const row of rows) {
        additionsByKind.set(row.kind, (additionsByKind.get(row.kind) ?? 0) + 1);
      }
      assert.deepEqual(
        new Set(additionsByKind.keys()),
        new Set(["polaris", "faq", "library", "insight"]),
        "the capped scan must retain inventory across artifact types",
      );
      for (const [kind, added] of additionsByKind) {
        const current = overview.byKind.find((row) => row.kind === kind);
        const prior = before.get(kind);
        assert.ok(current, `${kind} must remain represented after a capped scan`);
        assert.equal(current.total, (prior?.total ?? 0) + added);
        assert.equal(
          current.pendingInspection,
          (prior?.pendingInspection ?? 0) + added,
          `${kind} inventory must be labelled pending until a provider verdict arrives`,
        );
      }
    } finally {
      __setEntriesForTesting(null);
      restoreScanEnv(previous);
      await db
        .delete(seoCoverageStatusTable)
        .where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(
          eq(seoCoverageRunsTable.trigger, "manual"),
          gte(seoCoverageRunsTable.startedAt, scanStart),
        ),
      );
    }
  });

// ─── Part 5: post-scan resubmission ──────────────────────────────────────────
//
// The scan must resubmit URLs classified "discovered-not-indexed" (Google
// preferred, Bing fallback). Tests inject Bing probes so the scan itself
// writes the desired bucket state into the DB — pre-seeding rows would be
// wiped by the scan's stale-row cleanup.

  // Helper: stub submitUrls and capture calls.
  function makeSubmitStub(submittedPerChannel: number): {
    stub: (origin: string, urls: string[], options?: SubmitOptions) => Promise<SubmitBundle>;
    calls: { origin: string; urls: string[] }[];
  } {
    const calls: { origin: string; urls: string[] }[] = [];
    const stub = async (origin: string, u: string[], _opts?: SubmitOptions): Promise<SubmitBundle> => {
      calls.push({ origin, urls: [...u] });
      return {
        origin,
        urls: u,
        results: [
          { target: "indexnow", ok: submittedPerChannel > 0, submitted: submittedPerChannel, status: 200 },
        ],
      };
    };
    return { stub, calls };
  }

  await t.test("resubmission: not-indexed rows (via Bing fallback) are passed to submitUrls and count is persisted", async () => {
    const tag = uniqueTag();
    // 3 entries: 2 will get bingBucket=discovered-not-indexed, 1 gets indexed.
    // Google is not configured → googleBucket="not-configured" (not a valid
    // coverage bucket) → Bing fallback applies in the resubmission query.
    const urls = [
      `https://${tag}.invalid/ni1`,
      `https://${tag}.invalid/ni2`,
      `https://${tag}.invalid/indexed`,
    ];
    const niSet = new Set([urls[0], urls[1]]);

    const { stub, calls } = makeSubmitStub(2);
    __setSubmitUrlsForTesting(stub);
    __setBingProbeForTesting(async (url) => ({
      bucket: niSet.has(url) ? "discovered-not-indexed" : "indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.skipped, false, "scan must not be skipped");

      assert.equal(calls.length, 1, "submitUrls must be called once");
      const submitted = calls[0].urls;
      assert.ok(submitted.includes(urls[0]), "ni1 must be resubmitted");
      assert.ok(submitted.includes(urls[1]), "ni2 must be resubmitted");
      assert.ok(!submitted.includes(urls[2]), "indexed URL must not be resubmitted");
      assert.equal(result.resubmittedCount, 2, "resubmittedCount must match submitted channel count");

      // The run row must persist the count.
      const [run] = await db
        .select({ resubmittedCount: seoCoverageRunsTable.resubmittedCount })
        .from(seoCoverageRunsTable)
        .orderBy(desc(seoCoverageRunsTable.startedAt))
        .limit(1);
      assert.equal(run?.resubmittedCount, 2, "run row must persist resubmittedCount");
    } finally {
      __setSubmitUrlsForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: count reflects channel submitted count, not total URLs selected", async () => {
    // submitUrls reports submitted=1 even though 2 URLs were passed (simulates
    // one channel partially succeeding). resubmittedCount must use the actual
    // submitted value, not the selected count.
    const tag = uniqueTag();
    const urls = [
      `https://${tag}.invalid/c1`,
      `https://${tag}.invalid/c2`,
    ];

    __setSubmitUrlsForTesting(async (origin, u, _opts) => ({
      origin,
      urls: u,
      results: [{ target: "indexnow", ok: true, submitted: 1, status: 200 }],
    }));
    __setBingProbeForTesting(async () => ({
      bucket: "discovered-not-indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.resubmittedCount, 1, "resubmittedCount must come from bundle.results, not selected count");
    } finally {
      __setSubmitUrlsForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: capped at 500 URLs", async () => {
    // 505 entries all returning discovered-not-indexed from Bing.
    // The resubmission query has a LIMIT 500, so submitUrls must receive at most 500.
    const tag = uniqueTag();
    const urls = Array.from({ length: 505 }, (_, i) =>
      `https://${tag}.invalid/p${String(i).padStart(4, "0")}`,
    );

    const { stub, calls } = makeSubmitStub(500);
    __setSubmitUrlsForTesting(stub);
    __setBingProbeForTesting(async () => ({
      bucket: "discovered-not-indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(calls.length, 1, "submitUrls must be called once");
      assert.equal(calls[0].urls.length, 500, "at most 500 URLs must be passed to submitUrls");
      assert.equal(result.resubmittedCount, 500, "resubmittedCount must reflect the cap");
    } finally {
      __setSubmitUrlsForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: all-channel failure keeps resubmittedCount at 0, scan still succeeds", async () => {
    const tag = uniqueTag();
    const urls = [`https://${tag}.invalid/ni-fail`];
    const submitCalls: string[][] = [];

    __setSubmitUrlsForTesting(async (origin, u, _opts) => {
      submitCalls.push([...u]);
      return {
        origin,
        urls: u,
        results: [
          { target: "indexnow", ok: false, submitted: 0, error: "INDEXNOW_KEY not set" },
          { target: "google-indexing", ok: false, submitted: 0, error: "SA not set" },
          { target: "bing-webmaster", ok: false, submitted: 0, error: "key not set" },
        ],
      };
    });
    __setBingProbeForTesting(async () => ({
      bucket: "discovered-not-indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.skipped, false, "scan must succeed even when all channels fail");
      assert.equal(result.resubmittedCount, 0, "resubmittedCount must be 0 when no channel submitted");
      assert.equal(submitCalls.length, 1, "submitUrls must still be called");
    } finally {
      __setSubmitUrlsForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: submitUrls throwing does not fail the scan", async () => {
    const tag = uniqueTag();
    const urls = [`https://${tag}.invalid/ni-throws`];

    __setSubmitUrlsForTesting(async () => {
      throw new Error("network failure");
    });
    __setBingProbeForTesting(async () => ({
      bucket: "discovered-not-indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.skipped, false, "scan must succeed even when submitUrls throws");
      assert.equal(result.resubmittedCount, 0, "resubmittedCount must be 0 when submitUrls threw");
    } finally {
      __setSubmitUrlsForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: a hung submission reaches a recoverable terminal state", async () => {
    const tag = uniqueTag();
    const urls = [`https://${tag}.invalid/ni-timeout`];

    // A custom client can hang even when built-in providers have timeouts.
    // The scan must time out the optional phase, write a terminal run, and
    // release the UI from its running state rather than stranding the lock.
    __setSubmitUrlsForTesting(
      async () => new Promise<SubmitBundle>(() => {}),
    );
    __setBingProbeForTesting(async () => ({
      bucket: "discovered-not-indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    process.env.SEO_COVERAGE_RESUBMISSION_TIMEOUT_MS = "25";
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.skipped, false);
      const [run] = await db
        .select()
        .from(seoCoverageRunsTable)
        .where(
          and(
            eq(seoCoverageRunsTable.trigger, "manual"),
            gte(seoCoverageRunsTable.startedAt, scanStart),
          ),
        )
        .orderBy(desc(seoCoverageRunsTable.startedAt))
        .limit(1);
      assert.ok(run?.finishedAt, "timed-out resubmission must finish the run");
      assert.match(run?.error ?? "", /resubmission timed out/i);
      assert.equal(
        (await getCoverageOverview()).scanRunning,
        false,
        "a completed run must not leave the dashboard polling or disable retry",
      );
    } finally {
      __setSubmitUrlsForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: a delayed submission remains visibly active while it holds the scanner", async () => {
    const tag = uniqueTag();
    const urls = [`https://${tag}.invalid/ni-delayed`];
    let signalStarted!: () => void;
    const submissionStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let resolveSubmission!: (bundle: SubmitBundle) => void;

    __setSubmitUrlsForTesting(async (origin, submittedUrls) => {
      signalStarted();
      return new Promise<SubmitBundle>((resolve) => {
        resolveSubmission = resolve;
      });
    });
    __setBingProbeForTesting(async () => ({
      bucket: "discovered-not-indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);

    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    const scanStart = new Date();
    try {
      const scan = runSeoCoverageScan("manual");
      await submissionStarted;
      assert.equal(
        (await getCoverageOverview()).scanRunning,
        true,
        "the dashboard must remain active until the lock-held resubmission ends",
      );
      resolveSubmission({
        origin: "https://example.com",
        urls,
        results: [{ target: "indexnow", ok: true, submitted: 1, status: 200 }],
      });
      await scan;
      assert.equal((await getCoverageOverview()).scanRunning, false);
    } finally {
      __setSubmitUrlsForTesting(null);
      __setBingProbeForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("stalled local owner: retry is held instead of re-entering its advisory lock", async () => {
    const tag = uniqueTag();
    const urls = [`https://${tag}.invalid/stalled-owner`];
    let resolveEntries!: (urls: string[]) => void;
    const entriesPending = new Promise<string[]>((resolve) => {
      resolveEntries = resolve;
    });
    let signalStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });

    __setEntriesForTesting(async () => entriesPending);
    const prevEnv = saveScanEnv();
    setupBingOnlyEnv();
    const scanStart = new Date();
    try {
      const firstRun = runSeoCoverageScan("manual", (result) => {
        assert.equal(result.status, "started");
        signalStarted();
      });
      await firstStarted;
      __markActiveScanStalledForTesting();

      const retry = await startSeoCoverageScan("manual");
      assert.equal(retry.started, false);
      assert.equal(retry.status, "scanner-held");
      assert.equal(typeof retry.runId, "string");

      resolveEntries([]);
      await firstRun;
    } finally {
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: Google-primary arm — discovered-not-indexed rows trigger submitUrls", async () => {
    // Google is configured; Bing is not. The mock Google client returns
    // "discovered-not-indexed" for two URLs and "indexed" for one. Only the
    // two not-indexed URLs must be passed to submitUrls — exercising the
    // `googleBucket = "discovered-not-indexed"` branch of the resubmission
    // query, which existing tests never reach (they all use Bing-only env).
    const tag = uniqueTag();
    const urls = [
      `https://${tag}.invalid/g-ni1`,
      `https://${tag}.invalid/g-ni2`,
      `https://${tag}.invalid/g-indexed`,
    ];
    const niSet = new Set([urls[0], urls[1]]);

    __setGoogleClientFactoryForTesting(async (_saJson) => ({
      request: async ({ data }: { data?: { inspectionUrl?: string } }) => {
        const inspectionUrl = (data as { inspectionUrl?: string } | undefined)?.inspectionUrl ?? "";
        const isNI = niSet.has(inspectionUrl);
        return {
          data: {
            inspectionResult: {
              indexStatusResult: {
                verdict: isNI ? "NEUTRAL" : "PASS",
                coverageState: isNI
                  ? "Discovered - currently not indexed"
                  : "Submitted and indexed",
              },
            },
          },
        };
      },
    }) as never);
    __setEntriesForTesting(async () => urls);
    const { stub, calls } = makeSubmitStub(2);
    __setSubmitUrlsForTesting(stub);

    const prevEnv = saveScanEnv();
    setupGoogleOnlyEnv();
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.skipped, false, "scan must not be skipped");
      assert.equal(result.googleChecked, 3, "all three URLs must be checked by Google");

      assert.equal(calls.length, 1, "submitUrls must be called once");
      const submitted = calls[0].urls;
      assert.ok(submitted.includes(urls[0]), "g-ni1 must be resubmitted via Google primary arm");
      assert.ok(submitted.includes(urls[1]), "g-ni2 must be resubmitted via Google primary arm");
      assert.ok(!submitted.includes(urls[2]), "indexed URL must not be resubmitted");
      assert.equal(result.resubmittedCount, 2, "resubmittedCount must reflect the two submitted URLs");
    } finally {
      __setGoogleClientFactoryForTesting(null);
      __setSubmitUrlsForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

  await t.test("resubmission: mixed Google-primary and Bing-fallback rows are both resubmitted", async () => {
    // Google + Bing both configured. Four URLs:
    //   url[0]: Google → discovered-not-indexed (primary arm)
    //   url[1]: Google → error, Bing → discovered-not-indexed (fallback arm)
    //   url[2]: Google → indexed (not resubmitted)
    //   url[3]: Google → error, Bing → indexed (not resubmitted)
    // Both url[0] and url[1] must appear in the submitUrls call.
    const tag = uniqueTag();
    const urls = [
      `https://${tag}.invalid/m-g-ni`,
      `https://${tag}.invalid/m-b-ni`,
      `https://${tag}.invalid/m-g-ok`,
      `https://${tag}.invalid/m-b-ok`,
    ];

    const googleErrorSet = new Set([urls[1], urls[3]]);
    const googleNiSet = new Set([urls[0]]);
    __setGoogleClientFactoryForTesting(async (_saJson) => ({
      request: async ({ data }: { data?: { inspectionUrl?: string } }) => {
        const inspectionUrl = (data as { inspectionUrl?: string } | undefined)?.inspectionUrl ?? "";
        if (googleErrorSet.has(inspectionUrl)) {
          // Simulate a Google API error for these URLs so the Bing fallback kicks in.
          throw new Error("simulated Google API error");
        }
        const isNI = googleNiSet.has(inspectionUrl);
        return {
          data: {
            inspectionResult: {
              indexStatusResult: {
                verdict: isNI ? "NEUTRAL" : "PASS",
                coverageState: isNI
                  ? "Discovered - currently not indexed"
                  : "Submitted and indexed",
              },
            },
          },
        };
      },
    }) as never);

    const bingNiSet = new Set([urls[1]]);
    __setBingProbeForTesting(async (url) => ({
      bucket: bingNiSet.has(url) ? "discovered-not-indexed" : "indexed",
      httpStatus: 200,
      lastCrawlAt: new Date(),
      raw: {},
      throttled: false,
    }));
    __setEntriesForTesting(async () => urls);
    const { stub, calls } = makeSubmitStub(2);
    __setSubmitUrlsForTesting(stub);

    const prevEnv = saveScanEnv();
    setupGoogleAndBingEnv();
    const scanStart = new Date();
    try {
      const result = await runSeoCoverageScan("manual");
      assert.equal(result.skipped, false, "scan must not be skipped");

      assert.equal(calls.length, 1, "submitUrls must be called once");
      const submitted = calls[0].urls;
      assert.ok(submitted.includes(urls[0]), "Google-primary not-indexed URL must be resubmitted");
      assert.ok(submitted.includes(urls[1]), "Bing-fallback not-indexed URL must be resubmitted");
      assert.ok(!submitted.includes(urls[2]), "Google-indexed URL must not be resubmitted");
      assert.ok(!submitted.includes(urls[3]), "Bing-indexed URL (with Google error) must not be resubmitted");
      assert.equal(result.resubmittedCount, 2, "resubmittedCount must cover both arms");
    } finally {
      __setGoogleClientFactoryForTesting(null);
      __setBingProbeForTesting(null);
      __setSubmitUrlsForTesting(null);
      __setEntriesForTesting(null);
      restoreScanEnv(prevEnv);
      await db.delete(seoCoverageStatusTable).where(inArray(seoCoverageStatusTable.url, urls));
      await db.delete(seoCoverageRunsTable).where(
        and(eq(seoCoverageRunsTable.trigger, "manual"), gte(seoCoverageRunsTable.startedAt, scanStart)),
      );
    }
  });

}); // end runSeoCoverageScan integration (serial parent)

// ─── Teardown ─────────────────────────────────────────────────────────────────

test.after(async () => {
  await pool.end();
});
