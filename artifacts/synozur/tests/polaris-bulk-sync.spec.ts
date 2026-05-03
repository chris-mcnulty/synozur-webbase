import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * #206 — Regression coverage for the "Re-sync all to library" button on
 * the admin Polaris episodes list (artifacts/synozur/src/pages/admin/
 * library/polaris-episodes-list.tsx).
 *
 * The button:
 *   1. Pops a `confirm()` dialog.
 *   2. POSTs to /api/cms/polaris/episodes/bulk-sync-collateral.
 *   3. On success, fires a toast with title "Bulk re-sync complete".
 *
 * This suite signs in as a verified admin (same gating as
 * polaris-collateral-sync.spec.ts), accepts the confirm dialog, clicks
 * the button, and asserts the success toast. The integration test in
 * artifacts/api-server/src/routes/polaris.bulkSync.test.ts already
 * exercises the DB side-effects; here we only verify the wiring from
 * the admin UI through to the success-toast branch.
 */

const ADMIN_EMAIL = process.env["E2E_ADMIN_EMAIL"];
const ADMIN_PASSWORD = process.env["E2E_ADMIN_PASSWORD"];

async function signInAsAdmin(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: false },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(
      `Admin sign-in failed (${res.status()}): ${body}. ` +
        "Ensure E2E_ADMIN_EMAIL points at a user with a verified email and " +
        "an admin or editor role grant.",
    );
  }
}

async function expectToastWithTitle(page: Page, title: string): Promise<void> {
  const toast = page.locator('[role="status"]', { hasText: title }).first();
  await expect(toast).toBeVisible({ timeout: 30_000 });
}

const AUTH_STATE_PATH = join(
  tmpdir(),
  `synozur-polaris-bulk-sync-auth-${process.pid}.json`,
);

const E2E_BASE_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:5000";

test.describe.serial("Polaris episodes list — Re-sync all to library", () => {
  test.beforeAll(async ({ browser }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      "Set E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD (verified user with admin/editor role) to enable",
    );
    const ctx = await browser.newContext({ baseURL: E2E_BASE_URL });
    await signInAsAdmin(ctx.request);
    await ctx.storageState({ path: AUTH_STATE_PATH });
    await ctx.close();
  });

  test.use({ storageState: AUTH_STATE_PATH });

  test('"Re-sync all to library" runs the bulk sync and shows the success toast', async ({
    page,
  }) => {
    // The button uses window.confirm() to gate destructive bulk action;
    // auto-accept it so the click reaches the mutation.
    page.on("dialog", (dialog) => {
      void dialog.accept();
    });

    await page.goto("/admin/library/polaris-episodes");

    const button = page.getByTestId("button-bulk-sync-polaris");
    // The button is gated on `canWrite` (admin or editor) — its presence
    // also doubles as a check that the test admin's role grant is wired.
    await expect(button).toBeVisible({ timeout: 15_000 });
    await expect(button).toBeEnabled();

    // Wait for the network response so the test fails fast with a useful
    // status code if the route 5xx's, instead of timing out on the toast.
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/cms/polaris/episodes/bulk-sync-collateral") &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );

    await button.click();

    const response = await responsePromise;
    expect(
      response.status(),
      `bulk-sync POST returned ${response.status()}: ${await response.text().catch(() => "<no body>")}`,
    ).toBe(200);

    await expectToastWithTitle(page, "Bulk re-sync complete");
  });
});
