import { test, expect } from "@playwright/test";

/**
 * #163 / L18 — Discovery-friendly 404 page + robots meta directives.
 *
 * The 404 page should give visitors who land on a stale URL an escape route
 * (sitemap sections, popular insights, optional search), and indexable
 * pages should opt into rich SERP previews via a `max-snippet` /
 * `max-image-preview` / `max-video-preview` robots meta tag.
 */

test.describe("404 page — discovery surface", () => {
  test("renders sitemap sections, popular insights, and the report form", async ({ page }) => {
    const res = await page.goto("/this-route-definitely-does-not-exist");
    // SPA returns 200 from the static server; the 404 surface is rendered
    // by the client router, so we don't assert on the HTTP status.
    expect(res).not.toBeNull();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Lost in the constellation/i,
    );

    // Sitemap sections — at least the four primary destinations show up.
    const sitemap = page.getByTestId("not-found-sitemap");
    await expect(sitemap).toBeVisible();
    await expect(sitemap.getByRole("link", { name: /Insights/i })).toBeVisible();
    await expect(sitemap.getByRole("link", { name: /Case Studies/i })).toBeVisible();
    await expect(sitemap.getByRole("link", { name: /Library/i })).toBeVisible();
    await expect(sitemap.getByRole("link", { name: /Contact/i })).toBeVisible();

    // Popular insights grid renders at least one card from the public API.
    const popular = page.getByTestId("not-found-popular-insights");
    await expect(popular).toBeVisible({ timeout: 10_000 });
    await expect(
      popular.getByTestId("not-found-popular-insight").first(),
    ).toBeVisible();

    // Report form is present so editors hear about real misses.
    await expect(page.getByTestId("not-found-report-form")).toBeVisible();
  });

  test("noindex robots tag is preserved on the 404 page", async ({ page }) => {
    await page.goto("/another-missing-path");
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
  });

  test("renders the search input and live results when /api/search is available", async ({ page }) => {
    // Mock both the availability probe and the actual query so the test
    // doesn't depend on whether #170 has shipped yet. The 404 page treats
    // any non-404 response as "endpoint exists".
    await page.route("**/api/search**", async (route) => {
      const url = new URL(route.request().url());
      const q = url.searchParams.get("q") ?? "";
      // Probe call carries the marker query.
      if (q === "__probe__") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              title: "AI strategy primer",
              url: "/insights/ai-strategy-primer",
              excerpt: "A short field guide.",
              kind: "insight",
            },
          ],
        }),
      });
    });

    await page.goto("/totally-missing-path");

    const searchBox = page.getByTestId("not-found-search");
    await expect(searchBox).toBeVisible();

    const input = page.getByTestId("not-found-search-input");
    await input.fill("strategy");
    await page.getByTestId("not-found-search-submit").click();

    const results = page.getByTestId("not-found-search-results");
    await expect(results).toBeVisible();
    await expect(
      results.getByTestId("not-found-search-result").first(),
    ).toContainText("AI strategy primer");
  });

  test("search input is hidden when /api/search is unavailable", async ({ page }) => {
    // Force /api/search to 404 to simulate the pre-#170 environment.
    await page.route("**/api/search**", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.goto("/yet-another-missing-path");
    // Search input should be hidden when the endpoint isn't shipped.
    await expect(page.getByTestId("not-found-search")).toHaveCount(0);
  });
});

test.describe("Robots meta directives — indexable pages", () => {
  test("home page emits max-snippet / max-image-preview / max-video-preview", async ({ page }) => {
    await page.goto("/");
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute(
      "content",
      /max-snippet:-1.*max-image-preview:large.*max-video-preview:-1/,
    );
  });

  test("an indexable insights detail page emits the rich-preview robots directive", async ({ page }) => {
    // Pick the first published post from the public list and visit its
    // detail page — that's the canonical "indexable artifact page" the
    // robots directive is meant to protect.
    const list = await page.request.get("/api/insights?pageSize=1");
    expect(list.ok(), `GET /api/insights should succeed (got ${list.status()})`).toBeTruthy();
    const body = (await list.json()) as { items: Array<{ slug: string }> };
    const slug = body.items[0]?.slug;
    test.skip(!slug, "no published insight available to verify rich-preview directive");

    await page.goto(`/insights/${slug}`);
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute(
      "content",
      /max-snippet:-1.*max-image-preview:large.*max-video-preview:-1/,
    );
    // And critically: the directive must NOT be noindex on a published
    // detail page.
    await expect(robots).not.toHaveAttribute("content", /noindex/);
  });
});
