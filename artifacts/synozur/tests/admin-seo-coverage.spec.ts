import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env["E2E_ADMIN_EMAIL"];
const ADMIN_PASSWORD = process.env["E2E_ADMIN_PASSWORD"];
const E2E_BASE_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:5000";

const fixedOverview = {
  lastRun: {
    id: "00000000-0000-4000-8000-000000000001",
    startedAt: "2026-08-19T12:00:00.000Z",
    finishedAt: "2026-08-19T12:05:00.000Z",
    trigger: "scheduled",
    urlCount: 3,
    googleConfigured: true,
    bingConfigured: true,
    googleChecked: 1,
    bingChecked: 1,
    bingThrottled: false,
    resubmittedCount: 0,
    error: null,
  },
  googleConfigured: true,
  bingConfigured: true,
  scanRunning: false,
  indexingTrends: {
    google: {
      provider: "google",
      completeSnapshotDays: 7,
      latestIndexedUrlCount: 120,
      latestSitemapUrlCount: 180,
      latestNetIndexedChange: 4,
      averageNetNewPerDay: 3.5,
      projectedDaysToFullIndex: 18,
      averageCheckedPerDay: 180,
      estimatedDaysForFullRecheck: null,
      days: [
        {
          date: "2026-08-19",
          sitemapUrlCount: 180,
          checkedUrlCount: 180,
          indexedUrlCount: 120,
          discoveredNotIndexedCount: 60,
          isComplete: true,
          confirmedNewlyIndexed: 4,
          netIndexedChange: 4,
        },
      ],
    },
    bing: {
      provider: "bing",
      completeSnapshotDays: 0,
      latestIndexedUrlCount: null,
      latestSitemapUrlCount: null,
      latestNetIndexedChange: null,
      averageNetNewPerDay: null,
      projectedDaysToFullIndex: null,
      averageCheckedPerDay: 18,
      estimatedDaysForFullRecheck: 10,
      days: [
        {
          date: "2026-08-19",
          sitemapUrlCount: 180,
          checkedUrlCount: 18,
          indexedUrlCount: 100,
          discoveredNotIndexedCount: 2,
          isComplete: false,
          confirmedNewlyIndexed: 1,
          netIndexedChange: null,
        },
      ],
    },
  },
  googleQuotaWarning: false,
  googleAuthWarning: false,
  bingThrottleWarning: false,
  byKind: [
    {
      kind: "insight",
      total: 3,
      inspected: 2,
      pendingInspection: 1,
      indexed: 1,
      discoveredNotIndexed: 1,
      crawlError: 0,
      soft404: 0,
      unknown: 0,
    },
  ],
};

/**
 * Regression coverage for the editor-facing distinctions introduced by the
 * coverage inventory dashboard. Authentication remains real so this confirms
 * the protected route works; the coverage API is deterministic so the test
 * does not depend on external provider quotas or a seeded scan result.
 */
test("SEO Coverage keeps sitemap, confirmed, and pending labels visible to admins", async ({
  browser,
}) => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run protected admin UI tests",
  );

  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    const signIn = await context.request.post("/api/auth/login", {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        rememberMe: false,
      },
    });
    expect(
      signIn.ok(),
      `Admin sign-in should succeed; got ${signIn.status()} ${await signIn.text()}`,
    ).toBeTruthy();

    const page = await context.newPage();
    let pendingDrillDownRequested = false;
    await page.route("**/api/cms/seo-coverage**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/cms/seo-coverage") {
        await route.fulfill({ json: fixedOverview });
        return;
      }
      if (url.pathname === "/api/cms/seo-coverage/urls") {
        pendingDrillDownRequested =
          url.searchParams.get("kind") === "insight" &&
          url.searchParams.get("bucket") === "pending-inspection";
        await route.fulfill({
          json: {
            rows: [
              {
                url: "https://www.synozur.com/insights/pending-e2e",
                path: "/insights/pending-e2e",
                artifactKind: "insight",
                googleBucket: "error",
                googleCoverageState: null,
                bingBucket: "not-checked",
                bingHttpStatus: null,
                lastCheckedAt: null,
              },
            ],
          },
        });
        return;
      }
      if (url.pathname === "/api/cms/seo-coverage/runs") {
        await route.fulfill({ json: { runs: [fixedOverview.lastRun] } });
        return;
      }
      await route.continue();
    });

    await page.goto("/admin/marketing/seo-coverage");

    await expect(
      page.getByRole("heading", { name: "SEO Coverage" }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Sitemap URLs" })).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Confirmed indexed" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Confirmed not indexed" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Pending inspection" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Every currently crawlable sitemap URL is included. Confirmed buckets come from a usable provider inspection; pending URLs are still in the sitemap but have not received one yet.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Indexing pace" }),
    ).toBeVisible();
    await expect(page.getByText("18 days")).toBeVisible();
    await expect(page.getByText("Whole-site index ETA")).toBeVisible();

    await page
      .getByTestId("seo-coverage-cell-insight-pending-inspection")
      .click();
    await expect(
      page.getByRole("heading", { name: "Insights · Pending inspection" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "/insights/pending-e2e" }),
    ).toBeVisible();
    expect(pendingDrillDownRequested).toBe(true);
  } finally {
    await context.close();
  }
});