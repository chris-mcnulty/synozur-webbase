import { test, expect, type Page } from "@playwright/test";

/**
 * #300 — Verify that the footer Services column stays in sync after an
 * admin saves a service, covering both the create and update mutation
 * paths in `service-edit.tsx`.
 *
 * The footer renders from the React Query cache keyed at
 * `["services", "footer"]` with a 5-minute staleTime. The mutation
 * success handlers in `service-edit.tsx` call:
 *
 *   qc.invalidateQueries({ queryKey: ["services"] })
 *
 * which marks `["services", "footer"]` stale (prefix match). The test
 * verifies this invalidation actually fires and causes the footer to
 * reflect the mutation result WITHOUT a full page reload, by:
 *
 *   1. Loading the admin edit page (full load establishes the SPA +
 *      React Query client).
 *   2. Saving the service (runs the mutation, cache invalidated).
 *   3. SPA-navigating to "/" via pushState + popstate dispatch so the
 *      same React Query client instance is active — no new page load.
 *   4. Asserting the footer refetches and renders the new title.
 *
 * Gated on `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD` exactly like the
 * other admin E2E tests; `test.skip` documents the harness when creds
 * are absent.
 *
 * Each test captures the original state up-front and restores it in a
 * `finally` block so a successful run leaves the DB exactly as found.
 */

const ADMIN_EMAIL = process.env["E2E_ADMIN_EMAIL"];
const ADMIN_PASSWORD = process.env["E2E_ADMIN_PASSWORD"];

interface ServiceListItem {
  id: string;
  slug: string;
  title: string;
  status?: string | null;
  active?: boolean | null;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
}

/**
 * Mirror the public visibility predicate from `listServicesWithSolutions`
 * so we only pick a service that `GET /api/services` (and therefore the
 * footer) will actually render. Draft, inactive, future-scheduled, or
 * retired services don't appear in the footer and would make the
 * assertion trivially unprovable.
 */
function isPubliclyVisible(s: ServiceListItem): boolean {
  if (s.status !== "published") return false;
  if (s.active === false) return false;
  const now = Date.now();
  if (s.publishedAt && new Date(s.publishedAt).getTime() > now) return false;
  if (s.unpublishedAt && new Date(s.unpublishedAt).getTime() <= now) return false;
  return true;
}

/**
 * SPA-navigate to `path` without a full page reload.
 *
 * Both the admin and public routes live in the same wouter SPA, sharing
 * one `QueryClient`. Pushing state and dispatching a `popstate` event
 * causes wouter's `useBrowserLocation` hook to update its location,
 * switching the rendered component tree while keeping the React Query
 * cache intact — so any invalidation performed by the admin mutation
 * will be visible in the refetched footer query.
 */
async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p: string) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  }, path);
}

/**
 * Sign in programmatically so the subsequent `page.goto()` to the admin
 * edit page passes through `AdminGate`. Returns once `/api/auth/me`
 * confirms the account holds at least the editor role.
 */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email, password, rememberMe: false },
  });
  expect(
    loginRes.ok(),
    `local login should succeed for ${email}; got ${loginRes.status()}`,
  ).toBeTruthy();

  const me = (await page.request.get("/api/auth/me").then((r) => r.json())) as {
    id?: string;
    roles?: string[];
  };
  expect(me.id, "/api/auth/me should resolve after login").toBeTruthy();

  const roles = me.roles ?? [];
  const isEditorOrAbove =
    roles.includes("admin") ||
    roles.includes("site_admin") ||
    roles.includes("editor");
  expect(
    isEditorOrAbove,
    `user must hold admin or editor role; got ${JSON.stringify(roles)}`,
  ).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Update mutation path
// ---------------------------------------------------------------------------

test.describe("Service cache stays in sync — update mutation", () => {
  test("renaming a service in the admin updates the footer without a full page reload", async ({
    page,
  }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      "Set E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD (editor or admin) to enable",
    );

    // -----------------------------------------------------------------------
    // 1. Authenticate.
    // -----------------------------------------------------------------------
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    // -----------------------------------------------------------------------
    // 2. Pick a publicly visible service to edit.
    // -----------------------------------------------------------------------
    const list = (await page.request
      .get("/api/cms/services")
      .then((r) => r.json())) as { items?: ServiceListItem[] };
    const items = list.items ?? [];
    const target = items.find(isPubliclyVisible) ?? null;

    test.skip(
      !target,
      "No publicly-visible service available to edit in this environment",
    );
    if (!target) return;

    const originalTitle = target.title;
    const stamp = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const newTitle = `${originalTitle} [E2E ${stamp}]`;

    try {
      // ---------------------------------------------------------------------
      // 3. Load the admin edit page (full page load — establishes the SPA
      //    and React Query client).
      // ---------------------------------------------------------------------
      await page.goto(`/admin/products/services/${target.id}/edit`);

      const titleInput = page.getByTestId("input-service-title");
      await expect(titleInput).toBeVisible({ timeout: 20_000 });

      // ---------------------------------------------------------------------
      // 4. Rename the service and save.
      // ---------------------------------------------------------------------
      await titleInput.fill(newTitle);

      const savePromise = page.waitForResponse(
        (resp) =>
          resp.request().method() === "PATCH" &&
          resp.url().includes(`/api/cms/services/${target.id}`),
        { timeout: 15_000 },
      );
      await page.getByTestId("button-save-service").click();
      const saveResp = await savePromise;
      expect(
        saveResp.ok(),
        `PATCH /api/cms/services/${target.id} should succeed; got ${saveResp.status()}`,
      ).toBeTruthy();

      // Confirm the toast ("Service saved") rendered so the onSuccess handler
      // — which calls invalidateQueries — has definitely run before we leave.
      await expect(page.getByText("Service saved", { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      // ---------------------------------------------------------------------
      // 5. SPA-navigate to the public home page WITHOUT a full page reload.
      //    The same React Query client instance is active. The cache entry
      //    ["services", "footer"] was marked stale by the invalidation in
      //    the mutation's onSuccess, so the footer refetches automatically
      //    when it mounts on the home route.
      // ---------------------------------------------------------------------
      await spaNavigate(page, "/");

      // Wait for the footer to appear (the Layout wraps public routes).
      const footer = page.locator("footer");
      await expect(footer).toBeVisible({ timeout: 15_000 });

      // ---------------------------------------------------------------------
      // 6. Assert the footer shows the renamed title.
      //    We locate the Services column inside the footer specifically to
      //    avoid false matches with other on-page occurrences of the title.
      // ---------------------------------------------------------------------
      const footerServicesColumn = footer.locator(
        "h3",
        { hasText: /^Services$/i },
      ).locator("..");
      await expect(
        footerServicesColumn.getByText(newTitle, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      // ---------------------------------------------------------------------
      // 7. Restore the original title so this run doesn't leave editorial
      //    noise in a shared dev / staging database.
      // ---------------------------------------------------------------------
      const restoreResp = await page.request.patch(
        `/api/cms/services/${target.id}`,
        { data: { title: originalTitle } },
      );
      expect(
        restoreResp.ok(),
        `cleanup PATCH should succeed; got ${restoreResp.status()}`,
      ).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Create mutation path
// ---------------------------------------------------------------------------

test.describe("Service cache stays in sync — create mutation", () => {
  test("creating a published service in the admin makes it appear in the footer without a full page reload", async ({
    page,
  }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      "Set E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD (editor or admin) to enable",
    );

    // -----------------------------------------------------------------------
    // 1. Authenticate.
    // -----------------------------------------------------------------------
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    const stamp = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const newTitle = `E2E Service ${stamp}`;

    let createdId: string | null = null;

    try {
      // ---------------------------------------------------------------------
      // 2. Open the "New Service" form (full page load — establishes the SPA
      //    and React Query client).
      // ---------------------------------------------------------------------
      await page.goto("/admin/products/services/new");

      const titleInput = page.getByTestId("input-service-title");
      await expect(titleInput).toBeVisible({ timeout: 20_000 });

      // ---------------------------------------------------------------------
      // 3. Fill in the title. Status defaults to "published" and Active to
      //    true in the form's EMPTY state, so no extra field changes are
      //    needed for the service to appear in the public footer.
      // ---------------------------------------------------------------------
      await titleInput.fill(newTitle);

      // Verify the status defaulted to "published" (the EMPTY form default).
      const statusTrigger = page.getByTestId("select-service-status");
      await expect(statusTrigger).toContainText(/published/i);

      // Verify the Active switch is on by default.
      const activeSwitch = page.getByTestId("switch-service-active");
      await expect(activeSwitch).toHaveAttribute("aria-checked", "true");

      // ---------------------------------------------------------------------
      // 4. Save — the create mutation fires POST /api/cms/services.
      //    After success the form navigates to the edit page for the new ID.
      // ---------------------------------------------------------------------
      const savePromise = page.waitForResponse(
        (resp) =>
          resp.request().method() === "POST" &&
          resp.url().includes("/api/cms/services"),
        { timeout: 15_000 },
      );
      await page.getByTestId("button-save-service").click();
      const saveResp = await savePromise;
      expect(
        saveResp.ok(),
        `POST /api/cms/services should succeed; got ${saveResp.status()}`,
      ).toBeTruthy();

      const created = (await saveResp.json()) as { id?: string };
      createdId = created.id ?? null;
      expect(
        createdId,
        "POST /api/cms/services should return the new service id",
      ).toBeTruthy();

      // Confirm the toast ("Service created") so the onSuccess handler —
      // which calls invalidateQueries — has run before we navigate away.
      await expect(
        page.getByText("Service created", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });

      // ---------------------------------------------------------------------
      // 5. SPA-navigate to the public home page WITHOUT a full page reload.
      // ---------------------------------------------------------------------
      await spaNavigate(page, "/");

      const footer = page.locator("footer");
      await expect(footer).toBeVisible({ timeout: 15_000 });

      // ---------------------------------------------------------------------
      // 6. Assert the new service appears in the footer Services column.
      // ---------------------------------------------------------------------
      const footerServicesColumn = footer.locator(
        "h3",
        { hasText: /^Services$/i },
      ).locator("..");
      await expect(
        footerServicesColumn.getByText(newTitle, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      // ---------------------------------------------------------------------
      // 7. Archive the newly-created service so it no longer appears on the
      //    public site and doesn't pollute the footer in future test runs.
      // ---------------------------------------------------------------------
      if (createdId) {
        const archiveResp = await page.request.patch(
          `/api/cms/services/${createdId}`,
          { data: { status: "archived", active: false } },
        );
        expect(
          archiveResp.ok(),
          `cleanup PATCH should succeed; got ${archiveResp.status()}`,
        ).toBeTruthy();
      }
    }
  });
});
