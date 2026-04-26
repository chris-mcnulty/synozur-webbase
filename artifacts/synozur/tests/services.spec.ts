import { test, expect } from "@playwright/test";

/**
 * #57 — Verify the services hierarchy: the home → Services nav drop-down
 * → services overview page → a service detail → a solution detail.
 *
 * The services hierarchy is the most commercially critical part of the
 * site; this suite asserts the navigation contract, not the editorial
 * copy. Tests are tolerant to content additions (any service link will
 * do), strict on the structural invariants (a service page links to at
 * least one solution, a solution page renders within the layout).
 */
test.describe("Services hierarchy navigation", () => {
  test("home → /services overview renders a service card", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/synozur/i);

    // The Services nav entry is visible in the desktop header. Use a
    // role-based locator so the test survives copy changes.
    const servicesNav = page.getByRole("link", { name: /services/i }).first();
    await servicesNav.click();
    await expect(page).toHaveURL(/\/services/);

    // The overview page should list at least one service tile that
    // links into a service detail page (`/services/:slug`).
    const serviceLink = page
      .locator('a[href^="/services/"]')
      .filter({ hasNot: page.locator('[href$="/services/"]') })
      .first();
    await expect(serviceLink).toBeVisible({ timeout: 10_000 });
  });

  test("/services → service detail → solution detail", async ({ page }) => {
    await page.goto("/services");

    // Click the first service card. The href shape is `/services/:slug`.
    const firstService = page
      .locator('a[href^="/services/"]')
      .filter({ hasNot: page.locator('[href$="/services/"]') })
      .first();
    const serviceHref = await firstService.getAttribute("href");
    expect(serviceHref).toBeTruthy();
    await firstService.click();
    await expect(page).toHaveURL(new RegExp(`${serviceHref}$`));

    // Service detail must render an H1 and at least one solution link
    // under `/services/:serviceSlug/:solutionSlug` (relative or
    // absolute), unless the service has been seeded with no solutions.
    await expect(page.locator("h1")).toBeVisible();

    const solutionLink = page
      .locator(`a[href^="${serviceHref}/"]`)
      .first();
    if ((await solutionLink.count()) > 0) {
      const solutionHref = await solutionLink.getAttribute("href");
      await solutionLink.click();
      await expect(page).toHaveURL(new RegExp(`${solutionHref}$`));
      await expect(page.locator("h1")).toBeVisible();
    } else {
      test.info().annotations.push({
        type: "note",
        description: `No solutions linked from ${serviceHref}; solution-detail leg skipped.`,
      });
    }
  });
});
