import { expect, test, type Page } from "@playwright/test";
import { contrastSamples, expectReadable } from "./helpers/readability";

const heading = "Plan a practical transformation with your leadership team and build lasting organizational confidence";
const html = `<h2>${heading}</h2>
<p>Explore a practical roadmap with <strong>clear priorities</strong> and <em>measurable outcomes</em>.</p>
<p><a href="/method">Read our approach</a> before your conversation.</p>
<ul><li>Align the leadership team</li><li>Choose the next step</li></ul>
<ol><li>Review the plan</li></ol><blockquote>Start with shared understanding.</blockquote>`;

async function fixture(page: Page, theme: "light" | "dark") {
  const forbidden: string[] = [];
  await page.addInitScript((theme) => localStorage.setItem("synozur-theme", theme), theme);
  // No real calendar is loaded, and no API request can escape to live data.
  await page.route("https://calendar.example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Inert calendar fixture</p>" }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if ((request.method() !== "GET" && !["/api/traffic/collect", "/api/metrics/cwv", "/api/csp/report"].includes(path))
      || /bookings.*(appointments|slots|services|graph)/.test(path)) forbidden.push(`${request.method()} ${path}`);
    let json: unknown = { items: [] };
    if (path === "/api/auth/session") json = { signedIn: false, user: null };
    if (path === "/api/site-settings") json = { siteTheme: "cosmic", bookingsRenderMode: "iframe" };
    if (path === "/api/landing-pages/readability-fixture") json = {
      id: "readability-fixture", slug: "readability-fixture", title: heading, status: "published",
      blocks: [
        { type: "hero", title: heading, theme: "nebula" },
        { type: "richText", heading: "Your next steps", bodyHtml: html },
        { type: "cta", theme: "light", body: "A heading is optional; your next step is not.",
          buttons: [{ label: "Explore the method", href: "/method" }] },
      ],
    };
    if (path === "/api/bookings/readability-fixture") json = {
      id: "readability-fixture", slug: "readability-fixture", title: heading,
      teaser: "A focused conversation about your next steps.", descriptionHtml: html,
      embedUrl: "https://calendar.example.test/inert", msBusinessId: null, active: true,
    };
    await route.fulfill({ json });
  });
  return () => expect(forbidden, "No writes, appointment creation, or Graph requests").toEqual([]);
}

async function assertLayout(page: Page, mobile: boolean) {
  const headings = page.locator("main h1, main .prose h2");
  expect(await headings.count()).toBe(2);
  for (const heading of await headings.all()) {
    await expect(heading).toBeVisible();
    const bounds = await heading.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      return { left: rect.left, right: rect.right, width: window.innerWidth,
        fits: el.scrollWidth <= el.clientWidth + 1, lines: range.getClientRects().length };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.fits).toBe(true);
    if (mobile) expect(bounds.lines).toBeGreaterThan(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The utility strip and main navigation must remain stacked, not overlap.
  const header = await page.locator("header").boundingBox();
  const utility = await page.getByRole("button", { name: /Switch to .* mode/ }).locator("..").boundingBox();
  const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(header).not.toBeNull();
  expect(utility).not.toBeNull();
  expect(Math.abs(utility!.y + utility!.height - header!.y)).toBeLessThanOrEqual(1);
  expect(header!.height).toBeCloseTo(4 * rem + 1, 0);
  if (mobile) await expect(page.getByTestId("header-search-button")).toBeHidden();
  else await expect(page.getByTestId("header-search-button")).toBeVisible();
}

for (const mobile of [false, true]) {
  for (const initial of ["light", "dark"] as const) {
    for (const kind of ["landing", "booking"] as const) {
      test(`${kind}: ${mobile ? "mobile" : "desktop"}, ${initial} and theme switching`, async ({ page }) => {
        await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 });
        const assertSafe = await fixture(page, initial);
        await page.goto(kind === "landing" ? "/readability-fixture" : "/start/readability-fixture");
        const prose = page.locator("main .prose");
        await expect(prose).toBeVisible();
        await expect(prose.locator("p")).toHaveCount(2);
        await expect(prose.locator("li")).toHaveCount(3);
        await expect(prose.locator("a")).toHaveAttribute("href", "/method");
        const content = await prose.innerHTML();
        const other = initial === "light" ? "dark" : "light";
        const colors: string[] = [];
        for (const theme of [initial, other, initial]) {
          if (theme !== initial || colors.length === 2) {
            await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
          }
          await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*\bdark\b).*$/);
          // Wait for color transitions, without hiding a contrast regression.
          await page.waitForTimeout(350);
          await expectReadable(prose.locator("h2, p, strong, em, a, li, blockquote"));
          colors.push((await contrastSamples(prose.locator("p").first()))[0].color);
          await assertLayout(page, mobile);
          await expect(prose).toHaveJSProperty("innerHTML", content);
          if (kind === "landing") {
            const cta = page.locator("section").filter({ hasText: "A heading is optional;" });
            await expect(cta.locator("h2")).toHaveCount(0);
            await expect(cta.getByRole("link", { name: "Explore the method" })).toHaveAttribute("href", "/method");
            await expectReadable(cta.locator("p"));
          } else {
            await expect(page.getByTestId("booking-embed").locator("iframe")).toHaveAttribute("src", "https://calendar.example.test/inert");
          }
        }
        expect(colors[0]).not.toBe(colors[1]);
        expect(colors[2]).toBe(colors[0]);
        assertSafe();
      });
    }
  }
}

test("contrast guard detects the original white-on-white failure", async ({ page }) => {
  await fixture(page, "light");
  await page.goto("/readability-fixture");
  const paragraph = page.locator("main .prose p").first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((el) => { el.style.color = "#fff"; el.style.backgroundColor = "#fff"; });
  expect((await contrastSamples(paragraph))[0].ratio).toBe(1);
});
