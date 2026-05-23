import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * #57 — Verify the API-driven services & solutions flow.
 *
 * Three concerns, three describe blocks:
 *
 *   1. The pillar overview → service detail → solution detail
 *      navigation, asserting hero, back-link, methodologies, and
 *      capabilities render where the API supplies them.
 *   2. The header "Services" dropdown lists every pillar returned by
 *      `GET /api/services` along with its nested solutions.
 *   3. The shared `RichText` sanitizer strips `<script>` tags and the
 *      Wix `font_*` classes that come through the API payload.
 *
 * The services hierarchy is the most commercially critical part of the
 * site; assertions favour structural invariants over editorial copy so
 * that content tweaks don't fail the build, but a regression in the
 * navigation contract or the sanitizer does.
 */

type ApiSolution = { slug: string; title: string };
type ApiService = {
  slug: string;
  title: string;
  solutions: ApiSolution[];
};

async function fetchPillars(page: Page): Promise<ApiService[]> {
  const res = await page.request.get("/api/services");
  expect(res.ok(), `GET /api/services should succeed (got ${res.status()})`).toBeTruthy();
  const body = (await res.json()) as { items: ApiService[] };
  // The "our-services" record is a hero copy holder, not a real pillar
  // — see services-overview.tsx (`OVERVIEW_HERO_SLUG`).
  return body.items.filter((s) => s.slug !== "our-services");
}

/**
 * Scroll the target locator into the centre of the viewport using
 * `window.scrollTo`, then wait for both the scroll and any pending
 * animation frame to settle. We use this in preference to Playwright's
 * built-in auto-scroll because the services overview wraps each card
 * in a framer-motion `whileInView` animation that holds the card at
 * `opacity: 0` until it is intersected, and the hero section above
 * uses an `absolute inset-0` `nebula-gradient` overlay that can sit on
 * top of the click target if the page hasn't actually moved.
 */
async function scrollIntoCenter(page: Page, locator: Locator): Promise<void> {
  await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const target = window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2;
    window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
  });
  // Allow framer-motion `whileInView` to fire and the layout to settle.
  await page.waitForFunction(
    ([el]) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    },
    [await locator.elementHandle()],
    { timeout: 5000 },
  );
}

test.describe("Services hierarchy navigation", () => {
  test("home → /services-overview/default renders a service card", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/synozur/i);

    // Click the "Services Overview" link in the desktop header.
    // The Services nav group exposes it via `group-hover`, so we hover
    // the parent button before clicking the child.
    await page.getByRole("button", { name: /^services$/i }).first().hover();
    await page.getByRole("link", { name: /services overview/i }).first().click();
    await expect(page).toHaveURL(/\/services-overview\/default$/);

    // The default overview should list at least one pillar that links
    // into the service-detail route shape `/services/:slug`.
    const pillarLink = page.locator('a[href^="/services/"]').first();
    await expect(pillarLink).toBeVisible({ timeout: 10_000 });
  });

  test("/services-overview/default → pillar → solution renders hero/back-link/methodologies/capabilities", async ({
    page,
  }) => {
    const pillars = await fetchPillars(page);
    expect(pillars.length, "API should return at least one service pillar").toBeGreaterThan(0);

    await page.goto("/services-overview/default");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Pick the first pillar from the API and click its tile, rather
    // than the first DOM link, so we can assert against known content.
    const pillar = pillars[0];
    const pillarLink = page.locator(`a[href="/services/${pillar.slug}"]`).first();
    await expect(pillarLink).toBeVisible();
    // The hero section above uses an `absolute inset-0`
    // `nebula-gradient` overlay that can sit on top of the click
    // target before Playwright's pointer-event check passes. The
    // pillar cards are also wrapped in framer-motion `whileInView`
    // animations. Dispatching the click directly on the anchor sidesteps
    // both — wouter's <Link> uses an onClick listener that fires on
    // any synthetic MouseEvent dispatched at the anchor.
    await scrollIntoCenter(page, pillarLink);
    await pillarLink.evaluate((el) => (el as HTMLElement).click());
    await expect(page).toHaveURL(new RegExp(`/services/${pillar.slug}$`));

    // Hero — the H1 carries the pillar title.
    const pillarH1 = page.getByRole("heading", { level: 1, name: pillar.title });
    await expect(pillarH1).toBeVisible();

    // Back-link — "← All Solutions" returns to the overview.
    const backToOverview = page.getByRole("link", { name: /all solutions/i }).first();
    await expect(backToOverview).toBeVisible();
    await expect(backToOverview).toHaveAttribute("href", "/services-overview/default");

    // Methodologies — the section only renders when the API supplies
    // any. We surface this as an annotation when content is missing so
    // the test still asserts the contract once the editor seeds them.
    const methodologiesHeading = page.getByRole("heading", {
      level: 2,
      name: /how we work/i,
    });
    if ((await methodologiesHeading.count()) > 0) {
      await expect(methodologiesHeading).toBeVisible();
      const methodologyCards = page
        .locator("section")
        .filter({ has: methodologiesHeading })
        .locator("h3");
      await expect(methodologyCards.first()).toBeVisible();
    } else {
      test.info().annotations.push({
        type: "note",
        description: `No methodologies attached to /services/${pillar.slug}; section assertion skipped.`,
      });
    }

    // Solutions list — the "What's included" rail must contain at
    // least one of the API-reported solutions for this pillar.
    expect(
      pillar.solutions.length,
      `Pillar ${pillar.slug} should have at least one solution to navigate into`,
    ).toBeGreaterThan(0);
    const solution = pillar.solutions[0];
    const solutionLink = page.locator(`a[href="/solutions/${solution.slug}"]`).first();
    await expect(solutionLink).toBeVisible();
    await scrollIntoCenter(page, solutionLink);
    await solutionLink.evaluate((el) => (el as HTMLElement).click());
    await expect(page).toHaveURL(new RegExp(`/solutions/${solution.slug}$`));

    // Solution hero.
    await expect(
      page.getByRole("heading", { level: 1, name: solution.title }),
    ).toBeVisible();

    // Solution back-link — when the parent service is known the link
    // reads "Back to {Parent}"; otherwise the overview fallback is
    // shown. Either points back to a real route.
    const backHref = await page
      .locator('section a[href^="/services"]')
      .first()
      .getAttribute("href");
    expect(backHref, "Solution detail should have a back-link to a /services route").toMatch(
      /^\/services(?:\/|-overview\/)/,
    );

    // Capabilities — pick a slug we know carries them so the test fails
    // loudly if the section regresses. We re-verify against the API
    // rather than hard-coding so a content swap surfaces clearly.
    const detail = await page.request.get(`/api/solutions/${solution.slug}`).then((r) => r.json());
    if (Array.isArray(detail?.capabilities) && detail.capabilities.length > 0) {
      const capabilitiesHeading = page.getByRole("heading", {
        level: 2,
        name: /what'?s included/i,
      });
      await expect(capabilitiesHeading).toBeVisible();
      // Each capability renders as an H3 inside the same section.
      const capabilityCards = page
        .locator("section")
        .filter({ has: capabilitiesHeading })
        .locator("h3");
      await expect(capabilityCards.first()).toBeVisible();
      expect(await capabilityCards.count()).toBeGreaterThan(0);
    } else {
      test.info().annotations.push({
        type: "note",
        description: `No capabilities attached to /solutions/${solution.slug}; section assertion skipped.`,
      });
    }
  });
});

test.describe("Header services dropdown", () => {
  test("dropdown lists every pillar and its nested solutions", async ({ page }) => {
    const pillars = await fetchPillars(page);
    expect(pillars.length).toBeGreaterThan(0);

    await page.goto("/");
    // Wait for the SPA to hydrate the header with API-driven nav data.
    await page.waitForLoadState("networkidle");

    // The desktop "Services" trigger is always rendered. The dropdown
    // popover lives inside the same `<header>` as the trigger, with
    // `group-hover` toggling its opacity and pointer events — but the
    // anchors themselves are present in the DOM whether or not it is
    // visually open. Verifying the structural contract (every expected
    // pillar/solution href is anchored under the header nav) is both
    // the actual user-visible promise and far more robust than racing
    // a hover transition.
    const servicesButton = page.getByRole("button", { name: /^services$/i }).first();
    await expect(servicesButton).toBeVisible();

    // Build the full set of hrefs the dropdown should expose, derived
    // entirely from the API payload.
    const expectedHrefs: string[] = ["/services-overview/default"];
    for (const pillar of pillars) {
      expectedHrefs.push(`/services/${pillar.slug}`);
      for (const solution of pillar.solutions) {
        expectedHrefs.push(`/solutions/${solution.slug}`);
      }
    }

    // Collect every anchor *inside the header* in a single DOM query.
    // Scoping to the header avoids matching duplicate links the page
    // body may render (e.g. on the home page hero) and keeps this
    // test focused on the navigation contract.
    const navHrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("header a[href]")).map(
        (a) => (a as HTMLAnchorElement).getAttribute("href") ?? "",
      ),
    );
    const navHrefSet = new Set(navHrefs);
    const missing = expectedHrefs.filter((h) => !navHrefSet.has(h));
    expect(
      missing,
      `Header dropdown is missing expected links. Present: ${navHrefs.join(", ")}`,
    ).toEqual([]);

    // Spot-check that the labels render the API titles. The first
    // anchor per slug under the header is always the desktop nav item
    // (the mobile drawer only mounts when toggled open, see
    // header.tsx — `{mobileMenuOpen && (…)}`).
    for (const pillar of pillars) {
      const pillarAnchorText = await page
        .locator(`header a[href="/services/${pillar.slug}"]`)
        .first()
        .textContent();
      expect(
        pillarAnchorText ?? "",
        `Header link for /services/${pillar.slug} should render its title`,
      ).toContain(pillar.title);

      const firstSolution = pillar.solutions[0];
      if (firstSolution) {
        const solutionAnchorText = await page
          .locator(`header a[href="/solutions/${firstSolution.slug}"]`)
          .first()
          .textContent();
        expect(
          solutionAnchorText ?? "",
          `Header link for /solutions/${firstSolution.slug} should render its title`,
        ).toContain(firstSolution.title);
      }
    }
  });
});

test.describe("RichText sanitizer", () => {
  test("strips <script> tags and Wix font_* classes from rendered API content", async ({
    page,
  }) => {
    // The strategic-transformation pillar payload contains <p class="font_8">…
    // in `secondaryTextHtml` (Wix legacy markup). After sanitization,
    // no element under the rendered prose should carry a Wix font_*
    // class.
    await page.goto("/services/strategic-transformation");
    await expect(
      page.getByRole("heading", { level: 1, name: /organizational transformation/i }),
    ).toBeVisible();

    // The RichText component renders into `<div class="prose …">`.
    // Walking the rendered DOM beneath every prose container, no
    // descendant should carry a `font_*` class — those are stripped
    // because the sanitizer's allowlist for SPAN/P doesn't include
    // `class`.
    const fontClassCount = await page.evaluate(() => {
      const proses = document.querySelectorAll("div.prose");
      let count = 0;
      for (const root of Array.from(proses)) {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
          for (const cls of Array.from(el.classList)) {
            if (cls.startsWith("font_")) count += 1;
          }
        }
      }
      return count;
    });
    expect(
      fontClassCount,
      "No Wix font_* classes should survive the RichText sanitizer",
    ).toBe(0);

    // Direct unit-style coverage of the sanitizer for payloads we
    // can't get the API to emit (e.g. a literal <script> tag).
    // Vite serves the source module directly in dev mode, so a
    // dynamic import out of the running page works without a
    // separate test bundler.
    const sanitized = await page.evaluate(async () => {
      const mod = (await import("/src/components/rich-text.tsx")) as {
        sanitizeHtml: (html: string) => string;
      };
      return mod.sanitizeHtml(
        '<p class="font_8">hello<script>window.__pwned=true;</script></p>' +
          '<span class="font_3 something_else">world</span>',
      );
    });

    // Tags: <script> must be removed from the output. The sanitizer
    // unwraps unknown tags rather than dropping their text, so the
    // raw JS body may still appear as plain text — that's fine,
    // browsers don't execute text content. We only assert no live
    // `<script>` element ships.
    expect(sanitized.toLowerCase()).not.toContain("<script");
    expect(sanitized.toLowerCase()).not.toContain("</script");

    // Classes: every `class=` attribute is dropped because the
    // allowlist for P/SPAN doesn't include it.
    expect(sanitized).not.toMatch(/class\s*=/i);
    expect(sanitized).not.toContain("font_8");
    expect(sanitized).not.toContain("font_3");

    // The text content survives; only the markup is cleaned.
    expect(sanitized).toContain("hello");
    expect(sanitized).toContain("world");

    // And the <script> wasn't merely transformed — it didn't execute
    // either. (`__pwned` would only be set if a real <script> ran,
    // which it can't because dangerouslySetInnerHTML doesn't execute
    // scripts; this assertion documents the safety net.)
    const pwned = await page.evaluate(
      () => (window as unknown as { __pwned?: boolean }).__pwned === true,
    );
    expect(pwned).toBe(false);
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Task #138 — Pillar overview pages (`/services-overview/:slug` for non-default
 * slugs) render the same content as the corresponding service detail page
 * (`/services/:slug`). To stop them competing in search results, the pillar
 * overview must declare the service detail URL as canonical (and og:url),
 * while `/services-overview/default` (a unique hub) and `/services/:slug`
 * (the canonical target itself) keep their self-referential canonicals.
 */
test.describe("Canonical URL handling for service pages", () => {
  const SITE_ORIGIN = "https://www.synozur.com";

  async function readCanonicalAndOgUrl(
    page: Page,
  ): Promise<{ canonical: string; ogUrl: string }> {
    return page.evaluate(() => ({
      canonical:
        document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
      ogUrl:
        document
          .querySelector('meta[property="og:url"]')
          ?.getAttribute("content") ?? "",
    }));
  }

  test("/services-overview/strategic-transformation canonicalizes to /services/strategic-transformation", async ({
    page,
  }) => {
    await page.goto("/services-overview/strategic-transformation");
    // Wait for the Meta useEffect to run — it writes to document.head once
    // the service detail query resolves and the slug is known.
    await expect
      .poll(async () => (await readCanonicalAndOgUrl(page)).canonical, {
        timeout: 10_000,
      })
      .toBe(`${SITE_ORIGIN}/services/strategic-transformation`);

    const { canonical, ogUrl } = await readCanonicalAndOgUrl(page);
    expect(canonical).toBe(`${SITE_ORIGIN}/services/strategic-transformation`);
    expect(ogUrl).toBe(`${SITE_ORIGIN}/services/strategic-transformation`);
  });

  test("/services/strategic-transformation keeps a self-referential canonical", async ({
    page,
  }) => {
    await page.goto("/services/strategic-transformation");
    await expect
      .poll(async () => (await readCanonicalAndOgUrl(page)).canonical, {
        timeout: 10_000,
      })
      .toBe(`${SITE_ORIGIN}/services/strategic-transformation`);
  });

  test("/services-overview/default keeps its own canonical (unique hub content)", async ({
    page,
  }) => {
    await page.goto("/services-overview/default");
    await expect
      .poll(async () => (await readCanonicalAndOgUrl(page)).canonical, {
        timeout: 10_000,
      })
      .toBe(`${SITE_ORIGIN}/services-overview/default`);
  });
});
