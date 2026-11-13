import { test, expect } from "@playwright/test";

test("Library updates query-only filters without a reload, including history", async ({ page }) => {
  const items = [
    {
      id: "library-filter-white-paper",
      slug: "library-filter-white-paper",
      type: "white_paper",
      title: "Library filter test white paper",
      description: "A deterministic filter fixture.",
      heroImage: "",
      pillar: "strategic",
      tags: [],
      url: "/library/library-filter-white-paper",
      publishedAt: "2026-01-01T00:00:00Z",
      featured: false,
    },
    {
      id: "library-filter-webinar",
      slug: "library-filter-webinar",
      type: "webinar",
      title: "Library filter test webinar",
      description: "A deterministic filter fixture.",
      heroImage: "",
      pillar: "technology",
      tags: [],
      url: "/library/library-filter-webinar",
      publishedAt: "2026-01-01T00:00:00Z",
      featured: false,
    },
  ];
  await page.route("**/api/collateral?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const types = params.get("type")?.split(",") ?? [];
    const pillars = params.get("pillar")?.split(",") ?? [];
    const q = (params.get("q") ?? "").toLowerCase();
    const filtered = items.filter((item) =>
      (!types.length || types.includes(item.type)) &&
      (!pillars.length || pillars.includes(item.pillar)) &&
      item.title.toLowerCase().includes(q),
    );
    await route.fulfill({
      json: { items: filtered, total: filtered.length, page: 1, pageSize: 12 },
    });
  });
  await page.goto("/library");
  const whitePaper = page.getByRole("heading", { name: items[0].title, exact: true });
  const webinar = page.getByRole("heading", { name: items[1].title, exact: true });
  await expect(whitePaper).toBeVisible();
  await expect(webinar).toBeVisible();
  // A document reload would erase this sentinel.
  await page.evaluate(() => { document.documentElement.dataset.libraryTest = "same-document"; });

  const typeChip = page.getByRole("button", { name: "WHITE PAPER", exact: true });
  await typeChip.click();
  await expect(page).toHaveURL(/type=white_paper/);
  await expect(whitePaper).toBeVisible();
  await expect(webinar).toHaveCount(0);
  await expect(typeChip).toHaveClass(/bg-primary/);

  await page.goBack();
  await expect(webinar).toBeVisible();
  await page.goForward();
  await expect(whitePaper).toBeVisible();
  await expect(webinar).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(webinar).toBeVisible();
  await page.getByRole("button", { name: "Technology Transformation", exact: true }).click();
  await expect(webinar).toBeVisible();
  await expect(whitePaper).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(whitePaper).toBeVisible();

  await page.getByRole("searchbox", { name: "Search the library" }).fill("webinar");
  await page.locator("form").filter({ has: page.locator("#library-search") })
    .getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=webinar/);
  await expect(webinar).toBeVisible();
  await expect(whitePaper).toHaveCount(0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(whitePaper).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-library-test", "same-document");
});