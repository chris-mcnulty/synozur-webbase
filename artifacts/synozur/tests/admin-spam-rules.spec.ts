import { test, expect } from "@playwright/test";

/**
 * #153 — End-to-end coverage for the spam filter rules card on
 * `/admin/site-config/site-settings`.
 *
 * The admin area normally requires Entra SSO, which Playwright cannot
 * drive headlessly. The api-server's `seedTestAdminIfConfigured` startup
 * hook upserts a local email+password admin user when
 * `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` are set in non-production
 * environments. This test signs in via the local `/api/auth/login`
 * endpoint (mirroring `admin-solution-content.spec.ts`) and exercises
 * each interaction on the spam rules card:
 *
 *   - Save a custom link-count threshold
 *   - Add and remove a keyword chip
 *   - Add and remove a domain chip
 *   - Verify the green "Saved" indicator appears
 *
 * Original site-settings values are captured up-front and restored in a
 * `finally` block so the dev/staging database is left exactly as it was
 * found, regardless of the path taken through the assertions.
 */

const ADMIN_EMAIL = process.env["E2E_ADMIN_EMAIL"];
const ADMIN_PASSWORD = process.env["E2E_ADMIN_PASSWORD"];

interface SiteSettings {
  requireCookieConsent: boolean;
  spamLinkThreshold: number | null;
  spamKeywords: string[] | null;
  spamDomainBlocklist: string[] | null;
}

test.describe("Admin spam rules card", () => {
  test("save threshold, add/remove keyword + domain chips, see Saved indicator", async ({
    page,
  }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      "Set E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD (admin) to enable",
    );

    // -------------------------------------------------------------------
    // 1. Programmatic local sign-in.
    // -------------------------------------------------------------------
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rememberMe: false },
    });
    expect(
      loginRes.ok(),
      `local login should succeed for ${ADMIN_EMAIL}; got ${loginRes.status()}`,
    ).toBeTruthy();

    const me = (await page.request.get("/api/auth/me").then((r) => r.json())) as {
      id?: string;
      roles?: string[];
    };
    expect(me.id, "/api/auth/me should resolve after login").toBeTruthy();
    expect(
      (me.roles ?? []).includes("admin"),
      `signed-in user must hold the admin role; got ${JSON.stringify(me.roles)}`,
    ).toBeTruthy();

    // -------------------------------------------------------------------
    // 2. Capture current values so we can restore them on the way out.
    // -------------------------------------------------------------------
    const before = (await page.request
      .get("/api/admin/site-settings")
      .then((r) => r.json())) as SiteSettings;

    // Generate unique chip values to avoid collisions with pre-existing
    // entries in shared dev databases.
    const stamp = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const keyword = `e2e-kw-${stamp}`;
    const domain = `e2e-${stamp}.example`;
    const targetThreshold =
      typeof before.spamLinkThreshold === "number" && before.spamLinkThreshold > 0
        ? before.spamLinkThreshold + 1
        : 4;

    try {
      await page.goto("/admin/site-config/site-settings");

      // ---------------------------------------------------------------
      // 3. Link threshold — type a new value, click Save, expect "Saved".
      // ---------------------------------------------------------------
      const thresholdInput = page.getByTestId("input-spam-link-threshold");
      await expect(thresholdInput).toBeVisible({ timeout: 20_000 });
      await thresholdInput.fill(String(targetThreshold));

      const thresholdSave = page.waitForResponse(
        (resp) =>
          resp.request().method() === "PATCH" &&
          resp.url().includes("/api/admin/site-settings"),
        { timeout: 15_000 },
      );
      await page.getByTestId("button-save-spam-link-threshold").click();
      const thresholdResp = await thresholdSave;
      expect(
        thresholdResp.ok(),
        `PATCH /api/admin/site-settings should succeed; got ${thresholdResp.status()}`,
      ).toBeTruthy();

      // The "Saved" indicator only shows for 2 seconds after a successful
      // mutation. Asserting once here exercises the success surface; the
      // chip add/remove steps below also fire the same indicator.
      await expect(page.getByTestId("text-saved-indicator")).toBeVisible({
        timeout: 5_000,
      });

      // ---------------------------------------------------------------
      // 4. Keyword chip — add via button, then remove via the trash icon.
      // ---------------------------------------------------------------
      const keywordInput = page.getByTestId("input-spam-keyword");
      await keywordInput.fill(keyword);
      const keywordAdd = page.waitForResponse(
        (resp) =>
          resp.request().method() === "PATCH" &&
          resp.url().includes("/api/admin/site-settings"),
        { timeout: 15_000 },
      );
      await page.getByTestId("button-add-spam-keyword").click();
      expect((await keywordAdd).ok()).toBeTruthy();
      await expect(page.getByText(keyword, { exact: true })).toBeVisible();

      const keywordRemove = page.waitForResponse(
        (resp) =>
          resp.request().method() === "PATCH" &&
          resp.url().includes("/api/admin/site-settings"),
        { timeout: 15_000 },
      );
      await page
        .getByRole("button", { name: `Remove keyword ${keyword}` })
        .click();
      expect((await keywordRemove).ok()).toBeTruthy();
      await expect(page.getByText(keyword, { exact: true })).toHaveCount(0);

      // ---------------------------------------------------------------
      // 5. Domain chip — add via button, then remove via the trash icon.
      // ---------------------------------------------------------------
      const domainInput = page.getByTestId("input-spam-domain");
      await domainInput.fill(domain);
      const domainAdd = page.waitForResponse(
        (resp) =>
          resp.request().method() === "PATCH" &&
          resp.url().includes("/api/admin/site-settings"),
        { timeout: 15_000 },
      );
      await page.getByTestId("button-add-spam-domain").click();
      expect((await domainAdd).ok()).toBeTruthy();
      await expect(page.getByText(domain, { exact: true })).toBeVisible();

      const domainRemove = page.waitForResponse(
        (resp) =>
          resp.request().method() === "PATCH" &&
          resp.url().includes("/api/admin/site-settings"),
        { timeout: 15_000 },
      );
      await page
        .getByRole("button", { name: `Remove domain ${domain}` })
        .click();
      expect((await domainRemove).ok()).toBeTruthy();
      await expect(page.getByText(domain, { exact: true })).toHaveCount(0);

      // ---------------------------------------------------------------
      // 6. Server-side state matches expectations.
      // ---------------------------------------------------------------
      const after = (await page.request
        .get("/api/admin/site-settings")
        .then((r) => r.json())) as SiteSettings;
      expect(after.spamLinkThreshold).toBe(targetThreshold);
      expect(after.spamKeywords ?? []).not.toContain(keyword);
      expect(after.spamDomainBlocklist ?? []).not.toContain(domain);
    } finally {
      // -------------------------------------------------------------------
      // 7. Restore previous spam settings exactly. We send the full triple
      //    so a partial restore can't leave one column drifted.
      // -------------------------------------------------------------------
      const restore = await page.request.patch("/api/admin/site-settings", {
        data: {
          requireCookieConsent: before.requireCookieConsent,
          spamLinkThreshold: before.spamLinkThreshold,
          spamKeywords: before.spamKeywords ?? [],
          spamDomainBlocklist: before.spamDomainBlocklist ?? [],
        },
      });
      expect(
        restore.ok(),
        `cleanup PATCH should succeed; got ${restore.status()}`,
      ).toBeTruthy();
    }
  });
});
