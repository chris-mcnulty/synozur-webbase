import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * #185 — Regression coverage for the Polaris episode editor's
 * Collateral Library sidebar card.
 *
 * The card has two distinct states driven by
 * `GET /api/cms/polaris/episodes/:id/collateral`:
 *
 *   1. Not in library → exposes a single "Add to library" button
 *      (`btn-collateral-add`). Clicking it POSTs to
 *      `/api/cms/polaris/episodes/:id/sync-collateral` and the card
 *      should flip to the "In library" state with a success toast.
 *
 *   2. In library → exposes "Sync to library" (`btn-collateral-sync`)
 *      which re-runs the same POST. The card stays in the "In library"
 *      state and the toast title flips to "Library entry synced".
 *
 * Auth model: admin actions on /cms/polaris/* require a session that
 * resolves to an `admin` or `editor` role. The local-password sign-in
 * path requires a verified email, so this suite is gated on
 * `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD` being supplied — the same
 * pattern `sign-in.spec.ts` uses for the Entra round-trip. CI provides
 * these via repo secrets when the e2e job is dispatched against a
 * stack that has a verified admin user provisioned.
 *
 * The test creates its own draft episode (unique slug + episode number
 * each run) so it doesn't depend on prior seeded data and tears it
 * down afterwards.
 */

const ADMIN_EMAIL = process.env["E2E_ADMIN_EMAIL"];
const ADMIN_PASSWORD = process.env["E2E_ADMIN_PASSWORD"];

interface PolarisEpisodeResponse {
  id: string;
  slug: string;
  title: string;
  episodeNumber: number;
}

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

async function createDraftEpisode(
  request: APIRequestContext,
  uniqueSuffix: string,
): Promise<PolarisEpisodeResponse> {
  // Episode number uniqueness isn't enforced at the DB level, but slug is.
  // A timestamp-derived suffix keeps re-runs collision-free against
  // pre-existing seeded rows. The episode number stays high (90000+) so it
  // doesn't shadow real seeded episodes in the admin list.
  const episodeNumber =
    90000 + Math.floor(Math.random() * 9999);
  const res = await request.post("/api/cms/polaris/episodes", {
    data: {
      title: `E2E Collateral Sync ${uniqueSuffix}`,
      slug: `e2e-collateral-sync-${uniqueSuffix}`,
      episodeNumber,
      summary: "Created by polaris-collateral-sync.spec.ts. Safe to delete.",
      audioUrl: "https://example.com/e2e.mp3",
      artworkUrl: "https://example.com/e2e.png",
      status: "draft",
      active: true,
      featured: false,
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(
      `Failed to create test episode (${res.status()}): ${body}`,
    );
  }
  return (await res.json()) as PolarisEpisodeResponse;
}

async function deleteEpisode(
  request: APIRequestContext,
  episodeId: string,
): Promise<void> {
  // Soft-delete; we ignore failures so afterAll never masks a real test
  // failure. The collateral DELETE is best-effort because the episode
  // delete cascades the linked collateral row anyway.
  await request
    .delete(
      `/api/cms/polaris/episodes/${encodeURIComponent(episodeId)}/sync-collateral`,
    )
    .catch(() => undefined);
  await request
    .delete(`/api/cms/polaris/episodes/${encodeURIComponent(episodeId)}`)
    .catch(() => undefined);
}

async function expectToastWithTitle(page: Page, title: string): Promise<void> {
  // Toasts are rendered by `<Toaster />` (radix-ui) and the title goes
  // into a `<ToastTitle>` element. Match by visible text — there is no
  // `data-testid` on individual toasts. We anchor on the toast role +
  // exact text so a coincidentally-rendered element with the same copy
  // elsewhere on the page can't satisfy the assertion.
  const toast = page.locator('[role="status"]', { hasText: title }).first();
  await expect(toast).toBeVisible({ timeout: 10_000 });
}

// Auth state lives in the OS temp dir so it never accidentally lands in
// the repo or in the playwright report bundle. Each test run gets its
// own filename to keep parallel suites from racing on the same path.
const AUTH_STATE_PATH = join(
  tmpdir(),
  `synozur-polaris-auth-${process.pid}.json`,
);

// Manual contexts created by `browser.newContext()` do **not** inherit
// `use.baseURL` from playwright.config.ts. We must pass it explicitly so
// (a) `request.post("/api/...")` resolves to the right host and
// (b) the cookie persisted via `storageState` is scoped to the same
// origin the page later visits — otherwise the saved session cookie
// won't apply when the suite navigates with the regular `page` fixture.
const E2E_BASE_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:5000";

test.describe.serial("Polaris episode editor — Collateral Library card", () => {
  let episode: PolarisEpisodeResponse | null = null;

  test.beforeAll(async ({ browser }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD,
      "Set E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD (verified user with admin/editor role) to enable",
    );

    // Use a dedicated APIRequestContext for setup so the resulting
    // session cookie is scoped to this suite's storage state. We bake
    // the same context into every `page` in the describe block via
    // `test.use({ storageState })` below.
    const ctx = await browser.newContext({ baseURL: E2E_BASE_URL });
    await signInAsAdmin(ctx.request);
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    episode = await createDraftEpisode(ctx.request, suffix);
    // Persist the cookie so each test in the suite starts authenticated.
    await ctx.storageState({ path: AUTH_STATE_PATH });
    await ctx.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!episode) return;
    const ctx = await browser.newContext({
      baseURL: E2E_BASE_URL,
      storageState: AUTH_STATE_PATH,
    });
    await deleteEpisode(ctx.request, episode.id);
    await ctx.close();
  });

  test.use({ storageState: AUTH_STATE_PATH });

  test('"Add to library" flips the card into the synced state', async ({
    page,
  }) => {
    test.skip(!episode, "episode setup failed");
    const id = episode!.id;

    // The admin router is mounted via `<Route path="/admin" nest>` in
    // App.tsx, so the polaris episode editor — registered inside
    // AdminRoutes as `/library/polaris-episodes/:id/edit` — is reachable
    // at `/admin/library/polaris-episodes/:id/edit` from the browser.
    await page.goto(`/admin/library/polaris-episodes/${id}/edit`);

    // The Collateral Library card only renders for non-new episodes,
    // and it has its own data-testid so we can scope every interaction
    // to it. Wait for the loading "Checking…" state to clear before
    // looking for the action buttons — `btn-collateral-add` is only
    // mounted once `collateralLinkQ` resolves to `null`.
    const card = page.getByTestId("collateral-library-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    const addButton = card.getByTestId("btn-collateral-add");
    await expect(addButton).toBeVisible({ timeout: 15_000 });
    await expect(addButton).toBeEnabled();

    await addButton.click();

    await expectToastWithTitle(page, "Added to library");

    // After the success toast, the card re-renders into the "In library"
    // branch: the "In library" status copy + the sync/remove buttons.
    await expect(card.getByText("In library")).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId("btn-collateral-sync")).toBeVisible();
    await expect(card.getByTestId("btn-collateral-remove")).toBeVisible();
    await expect(card.getByTestId("btn-collateral-add")).toHaveCount(0);
  });

  test('"Sync to library" on an already-synced episode shows the synced toast', async ({
    page,
  }) => {
    test.skip(!episode, "episode setup failed");
    const id = episode!.id;

    await page.goto(`/admin/library/polaris-episodes/${id}/edit`);

    const card = page.getByTestId("collateral-library-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The episode was added to the library by the previous test; if
    // tests are run in isolation the card may still be in "Add" state,
    // in which case we add it first so this test exercises the
    // re-sync branch (toast title === "Library entry synced") rather
    // than the initial-add branch.
    const addButton = card.getByTestId("btn-collateral-add");
    if ((await addButton.count()) > 0) {
      await addButton.click();
      await expectToastWithTitle(page, "Added to library");
      await expect(card.getByText("In library")).toBeVisible({ timeout: 10_000 });
    }

    const syncButton = card.getByTestId("btn-collateral-sync");
    await expect(syncButton).toBeVisible({ timeout: 15_000 });
    await expect(syncButton).toBeEnabled();

    await syncButton.click();

    await expectToastWithTitle(page, "Library entry synced");

    // The card should still be in the "In library" state — sync is a
    // no-op on the local UI shape beyond updating the `Synced …` date.
    await expect(card.getByText("In library")).toBeVisible();
  });
});
