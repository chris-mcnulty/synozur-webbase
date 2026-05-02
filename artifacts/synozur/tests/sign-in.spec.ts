import { test, expect } from "@playwright/test";

/**
 * Clerk-removal cleanup #9 — Playwright sign-in smoke test.
 *
 * Two tiers, gated on env vars so CI doesn't require an Entra test tenant
 * by default:
 *
 *   1. Always-on: render assertions on `/sign-in` itself — the form is
 *      visible, the Entra button is wired correctly when the server has
 *      reported `entraConfigured: true`, and a click initiates the
 *      `/api/auth/sign-in` redirect (followed to `login.microsoftonline.com`
 *      and then aborted before any credential is entered).
 *
 *   2. Full Entra round-trip: `/sign-in → Entra → /callback → /api/auth/me`,
 *      using the test tenant credential at `E2E_ENTRA_TEST_USER_EMAIL` /
 *      `E2E_ENTRA_TEST_USER_PASSWORD`. Skipped automatically when those env
 *      vars are unset; in that mode the test serves only as documentation
 *      of the manual round-trip until a service-account credential exists.
 */

const ENTRA_TEST_USER = process.env["E2E_ENTRA_TEST_USER_EMAIL"];
const ENTRA_TEST_PASS = process.env["E2E_ENTRA_TEST_USER_PASSWORD"];

test.describe("Sign-in smoke", () => {
  test("/sign-in renders the form and (if configured) the Entra button", async ({ page, request }) => {
    await page.goto("/sign-in");
    await expect(page.getByTestId("button-sign-in")).toBeVisible();

    const cfg = await request
      .get("/api/auth/config")
      .then((r) => r.json() as Promise<{ entraConfigured?: boolean }>)
      .catch(() => ({ entraConfigured: false }));

    if (cfg.entraConfigured) {
      const button = page.getByTestId("button-sign-in-microsoft");
      await expect(button).toBeVisible();
    } else {
      await expect(page.getByTestId("button-sign-in-microsoft")).toHaveCount(0);
    }
  });

  test("Entra button initiates the OIDC redirect", async ({ page, request, context }) => {
    const cfg = await request
      .get("/api/auth/config")
      .then((r) => r.json() as Promise<{ entraConfigured?: boolean }>)
      .catch(() => ({ entraConfigured: false }));
    test.skip(!cfg.entraConfigured, "Entra not configured in this env");

    await page.goto("/sign-in");
    // Block the actual navigation to login.microsoftonline.com so the test
    // doesn't depend on Microsoft's login page being reachable; we only
    // assert that our server emitted the expected redirect.
    await context.route("**/login.microsoftonline.com/**", (route) => route.abort());

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/auth/sign-in"),
      { timeout: 10_000 },
    );
    await page.getByTestId("button-sign-in-microsoft").click();
    const res = await responsePromise;
    // The /api/auth/sign-in endpoint 302s to Microsoft's authorize URL.
    expect([302, 303, 307]).toContain(res.status());
    const location = res.headers()["location"] ?? "";
    expect(location).toMatch(/login\.microsoftonline\.com/);
    expect(location).toMatch(/[?&]client_id=/);
    expect(location).toMatch(/[?&]code_challenge=/);
  });

  test("full /sign-in → Entra → /callback → /api/auth/me round-trip", async ({ page }) => {
    test.skip(
      !ENTRA_TEST_USER || !ENTRA_TEST_PASS,
      "Set E2E_ENTRA_TEST_USER_EMAIL + E2E_ENTRA_TEST_USER_PASSWORD to enable",
    );

    await page.goto("/sign-in");
    await page.getByTestId("button-sign-in-microsoft").click();

    // Microsoft's hosted login page — selectors mirror the documented test
    // automation pattern. Conditional access / MFA on the test account will
    // break this; the test tenant should be configured without those.
    await page.waitForURL(/login\.microsoftonline\.com/, { timeout: 30_000 });
    await page.locator('input[type="email"]').fill(ENTRA_TEST_USER!);
    await page.locator('input[type="submit"]').click();
    await page.locator('input[type="password"]').fill(ENTRA_TEST_PASS!);
    await page.locator('input[type="submit"]').click();
    // "Stay signed in?" prompt — answer No.
    const noButton = page.locator('input[type="button"][value="No"]');
    if (await noButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await noButton.click();
    }

    // Back on our origin, the /callback route consumes the OAuth code and
    // redirects to `/` (or returnTo). Wait for the URL to leave the
    // login.microsoftonline.com host — Playwright's predicate-based
    // waitForURL fires whenever the URL changes, so anchoring the check
    // on the host means we wait through the post-Microsoft redirects
    // (consent → /callback → /) until we're back on this app.
    await page.waitForURL(
      (url) => !url.hostname.includes("login.microsoftonline.com"),
      { timeout: 30_000 },
    );

    // Use the page's bound request context (not the standalone `request`
    // fixture) so `/api/auth/me` carries the session cookie just set by
    // the /callback flow. Otherwise the request would go through a fresh
    // context with no cookies and always come back unauthenticated.
    const me = await page.request
      .get("/api/auth/me")
      .then((r) => r.json() as Promise<{ id?: string; email?: string }>);
    expect(me.id).toBeTruthy();
    expect(me.email?.toLowerCase()).toBe(ENTRA_TEST_USER!.toLowerCase());
  });
});
