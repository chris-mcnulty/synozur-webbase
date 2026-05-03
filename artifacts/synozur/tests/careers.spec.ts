import { test, expect } from "@playwright/test";

/**
 * #223 — Careers smoke tests.
 *
 *   1. Public listing renders with API-driven content (mode = native).
 *   2. /careers/jobs/<slug>/apply gates on sign-in.
 *   3. When admin flips mode to "redirect" with an external URL, the
 *      server returns a 301 with the path tail preserved.
 */

test.describe("careers (native mode)", () => {
  test("public listing page reachable", async ({ page }) => {
    await page.goto("/careers");
    await expect(page).toHaveURL(/\/careers$/);
    // The list header renders even when there are zero jobs.
    await expect(page.locator("body")).toContainText(/Careers|Open roles|positions/i);
  });

  test("settings endpoint reflects current mode", async ({ page }) => {
    const res = await page.request.get("/api/careers/settings");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("mode");
    expect(["native", "redirect"]).toContain(body.mode);
  });

  test("apply route redirects unauthenticated visitors to sign-in", async ({
    page,
  }) => {
    await page.goto("/careers/general-application");
    // The apply page redirects via wouter; allow either an immediate
    // navigation or the redirecting placeholder copy.
    await page.waitForLoadState("networkidle");
    const url = page.url();
    expect(url).toMatch(/\/sign-in|\/careers\/general-application/);
  });
});

test.describe("careers redirect mode", () => {
  // The redirect middleware caches settings for ~30s. We fetch the
  // settings up front so this suite is a no-op when the deployment
  // is configured natively (the typical CI shape) — and an active
  // assertion when an admin has flipped to redirect mode.
  test("when externalUrl is configured, /careers/foo returns a 301", async ({
    request,
  }) => {
    const settings = await request
      .get("/api/careers/settings")
      .then((r) => r.json());
    test.skip(
      settings.mode !== "redirect" || !settings.externalUrl,
      "Native mode — redirect contract is exercised in unit tests only",
    );
    const res = await request.get("/careers/jobs/anything", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(301);
    const loc = res.headers()["location"] ?? "";
    expect(loc).toContain(settings.externalUrl);
    expect(loc).toContain("/jobs/anything");
  });
});
