import { test, expect } from "@playwright/test";

/**
 * #193 — Round-trip test for the Accelerators / FAQ rich-text editors
 * added to the Solution admin form in #188. We sign in as an editor or
 * admin, edit `acceleratorsHtml` and `faqHtml` for an existing published
 * Solution, save, and assert the new markers render on the public
 * `/solutions/:slug` page.
 *
 * Auth: gated on `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`. The login
 * happens via the local password endpoint at `POST /api/auth/login`,
 * which is the same path the SPA's sign-in form uses. The supplied
 * account must have an editor or admin role (or have its email listed
 * in `ADMIN_EMAILS` so the server auto-grants admin on sign-in). The
 * test is `test.skip`'d when the credentials are unset, mirroring the
 * pattern established by `sign-in.spec.ts` for the full Entra
 * round-trip — it then serves as documentation for the manual harness
 * until a CI service-account credential is wired up.
 *
 * The test deliberately edits an *existing* published solution (rather
 * than seeding a fresh one) so it doesn't depend on schema knowledge of
 * which fields are required to publish a solution end-to-end. Original
 * `acceleratorsHtml` / `faqHtml` values are captured up-front and
 * restored in a `finally` block so a successful run leaves the database
 * exactly as it found it.
 */

const ADMIN_EMAIL = process.env["E2E_ADMIN_EMAIL"];
const ADMIN_PASSWORD = process.env["E2E_ADMIN_PASSWORD"];

interface SolutionListItem {
  id: string;
  slug: string;
  title: string;
  status?: string | null;
  active?: boolean | null;
  publishedAt?: string | null;
  unpublishedAt?: string | null;
  acceleratorsHtml?: string | null;
  faqHtml?: string | null;
}

/**
 * Mirror the public visibility predicate so the test only ever picks a
 * solution that the public `/solutions/:slug` endpoint will actually
 * serve. A draft, inactive, future-published, or already-unpublished
 * solution would 404 and cause a false failure.
 */
function isPubliclyVisible(s: SolutionListItem): boolean {
  if (s.status !== "published") return false;
  if (s.active === false) return false;
  const now = Date.now();
  if (s.publishedAt && new Date(s.publishedAt).getTime() > now) return false;
  if (s.unpublishedAt && new Date(s.unpublishedAt).getTime() <= now) {
    return false;
  }
  return true;
}

test.describe("Admin Solution Accelerators/FAQ round-trip", () => {
  test("editing acceleratorsHtml + faqHtml renders on /solutions/:slug", async ({
    page,
  }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      "Set E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD (editor or admin) to enable",
    );

    // ---------------------------------------------------------------------
    // 1. Programmatic sign-in.
    // ---------------------------------------------------------------------
    // Use the page-bound request context so the session cookie set by
    // /api/auth/login carries through to the subsequent page.goto() calls.
    const loginRes = await page.request.post("/api/auth/login", {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        rememberMe: false,
      },
    });
    expect(
      loginRes.ok(),
      `local login should succeed for ${ADMIN_EMAIL}; got ${loginRes.status()}`,
    ).toBeTruthy();

    const me = (await page.request
      .get("/api/auth/me")
      .then((r) => r.json())) as {
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
      `signed-in user must hold admin or editor role; got ${JSON.stringify(roles)}`,
    ).toBeTruthy();

    // ---------------------------------------------------------------------
    // 2. Pick an existing published solution to edit.
    // ---------------------------------------------------------------------
    const list = (await page.request
      .get("/api/cms/solutions")
      .then((r) => r.json())) as { items?: SolutionListItem[] };
    const items = list.items ?? [];
    const target = items.find(isPubliclyVisible) ?? null;
    test.skip(
      !target,
      "No publicly-visible solution available to edit in this environment",
    );
    if (!target) return; // narrow for TypeScript.

    const original = {
      acceleratorsHtml: target.acceleratorsHtml ?? null,
      faqHtml: target.faqHtml ?? null,
    };

    // Unique markers so we can recognise our edits on the public page
    // even when the database already has accelerators / FAQ content.
    const stamp = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const acceleratorMarker = `E2E accelerator marker ${stamp}`;
    const faqMarker = `E2E faq marker ${stamp}`;

    try {
      // -------------------------------------------------------------------
      // 3. Drive the admin edit form.
      // -------------------------------------------------------------------
      await page.goto(`/admin/products/solutions/${target.id}/edit`);

      const acceleratorsWrapper = page.getByTestId(
        "editor-solution-accelerators",
      );
      const faqWrapper = page.getByTestId("editor-solution-faq");
      await expect(acceleratorsWrapper).toBeVisible({ timeout: 20_000 });
      await expect(faqWrapper).toBeVisible();

      // TipTap renders a contenteditable ProseMirror node inside each
      // editor wrapper — there is no native textarea to fill().
      const acceleratorEditor = acceleratorsWrapper
        .locator('[contenteditable="true"]')
        .first();
      const faqEditor = faqWrapper.locator('[contenteditable="true"]').first();

      await acceleratorEditor.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Delete");
      await acceleratorEditor.pressSequentially(acceleratorMarker, {
        delay: 5,
      });

      await faqEditor.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Delete");
      await faqEditor.pressSequentially(faqMarker, { delay: 5 });

      // Save and wait specifically for the PATCH that updates this row.
      const savePromise = page.waitForResponse(
        (resp) =>
          resp.request().method() === "PATCH" &&
          resp.url().includes(`/api/cms/solutions/${target.id}`),
        { timeout: 15_000 },
      );
      await page.getByTestId("button-save-solution").click();
      const saveResp = await savePromise;
      expect(
        saveResp.ok(),
        `PATCH /api/cms/solutions/${target.id} should succeed; got ${saveResp.status()}`,
      ).toBeTruthy();

      // -------------------------------------------------------------------
      // 4. Verify the edits via the API directly (server-side truth) ...
      // -------------------------------------------------------------------
      const fresh = (await page.request
        .get("/api/cms/solutions")
        .then((r) => r.json())) as { items?: SolutionListItem[] };
      const updated = (fresh.items ?? []).find((s) => s.id === target.id);
      expect(updated?.acceleratorsHtml ?? "").toContain(acceleratorMarker);
      expect(updated?.faqHtml ?? "").toContain(faqMarker);

      // -------------------------------------------------------------------
      // ... and via the rendered public detail page (full round-trip).
      // -------------------------------------------------------------------
      // The target was filtered up-front to be publicly visible, so the
      // public route is guaranteed to render rather than 404 — every
      // non-skipped run exercises the full SPA fetch path.
      await page.goto(`/solutions/${target.slug}`);
      await expect(
        page.getByText(acceleratorMarker, { exact: false }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(faqMarker, { exact: false }),
      ).toBeVisible();
    } finally {
      // -------------------------------------------------------------------
      // 5. Restore original content so the test doesn't leave editorial
      //    noise behind on a shared dev / staging database. We assert the
      //    cleanup succeeds so a silent failure surfaces in CI rather
      //    than slowly polluting the seeded data set across runs.
      // -------------------------------------------------------------------
      const restoreResp = await page.request.patch(
        `/api/cms/solutions/${target.id}`,
        {
          data: {
            acceleratorsHtml: original.acceleratorsHtml,
            faqHtml: original.faqHtml,
          },
        },
      );
      expect(
        restoreResp.ok(),
        `cleanup PATCH should succeed; got ${restoreResp.status()}`,
      ).toBeTruthy();
    }
  });
});
