import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * #142 Phase C — Accessibility regression checks.
 *
 * Runs axe-core against a representative set of public routes and fails
 * the test when any violation is at severity ≥ "serious". Less-severe
 * findings (`minor`, `moderate`) are surfaced as warnings in the test
 * annotations so they can be triaged without blocking the build.
 *
 * Phase D will turn serious violations into a publish-state gate. This
 * suite is the upstream signal for that gate.
 */

interface RouteCase {
  name: string;
  path: string;
}

const ROUTES: RouteCase[] = [
  { name: "Home", path: "/" },
  { name: "Insights index", path: "/insights" },
  { name: "Library index", path: "/library" },
  { name: "Services overview", path: "/services" },
  { name: "Applications overview", path: "/applications" },
  { name: "Contact", path: "/contact" },
];

// WCAG 2.2 AA — the legal/procurement target. Best-practice rules add
// useful guidance (`region`, `landmark-one-main`) that are flagged at
// `moderate` severity and surfaced in annotations.
const TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

// Severity threshold above which a violation fails the build. Anything
// below this surfaces as a test annotation only.
const FAIL_AT_OR_ABOVE: Array<"minor" | "moderate" | "serious" | "critical"> = [
  "serious",
  "critical",
];

for (const route of ROUTES) {
  test(`a11y: ${route.name} (${route.path})`, async ({ page }) => {
    await page.goto(route.path);
    // Defer scanning until the layout has settled so we don't trip
    // transient ARIA states from animations/loaders.
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(TAGS)
      .analyze();

    const failing = results.violations.filter((v) =>
      FAIL_AT_OR_ABOVE.includes(
        (v.impact as (typeof FAIL_AT_OR_ABOVE)[number]) ?? "minor",
      ),
    );

    // Surface every non-failing violation as a test annotation so it
    // shows up in the GitHub Actions summary without breaking the run.
    for (const v of results.violations) {
      if (failing.includes(v)) continue;
      test.info().annotations.push({
        type: `a11y-${v.impact ?? "minor"}`,
        description: `${v.id} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}): ${v.help}`,
      });
    }

    if (failing.length > 0) {
      const summary = failing
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.help} — ${v.nodes.length} node(s)\n  ${v.helpUrl}`,
        )
        .join("\n");
      throw new Error(
        `${failing.length} serious+ axe violation(s) on ${route.path}:\n${summary}`,
      );
    }
    expect(failing).toHaveLength(0);
  });
}
