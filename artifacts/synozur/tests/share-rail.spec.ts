import { test, expect, type Page } from "@playwright/test";

/**
 * Task #239 — Share rail on editorial detail pages.
 *
 * Asserts that the reusable `<ShareRail>` component lifted out of
 * event-detail renders on at least one editorial surface (insight
 * detail) with the expected share targets, and that each href is a
 * valid pre-filled share URL containing the encoded post URL (and,
 * for X, the post title).
 */

type ApiPost = { slug: string; title: string };

async function pickPublishedInsightSlug(page: Page): Promise<ApiPost | null> {
  const res = await page.request.get("/api/insights?page=1&pageSize=1");
  if (!res.ok()) return null;
  const body = (await res.json()) as { items?: ApiPost[] };
  const first = body.items?.[0];
  return first ? { slug: first.slug, title: first.title } : null;
}

test.describe("Share rail on editorial detail pages (#239)", () => {
  test("insight-detail renders LinkedIn / X / Facebook / copy with correctly-encoded hrefs", async ({
    page,
  }) => {
    const post = await pickPublishedInsightSlug(page);
    test.skip(!post, "No published insight posts in target environment");
    if (!post) return;

    await page.goto(`/insights/${post.slug}`);
    // The hero/body lazy-renders behind a query — wait for the article H1.
    await expect(page.getByRole("heading", { level: 1, name: post.title })).toBeVisible();

    const rail = page.getByTestId("share-rail-insight");
    await expect(rail).toBeVisible();

    const expectedUrlFragment = encodeURIComponent(`/insights/${post.slug}`);

    const linkedin = rail.getByTestId("share-linkedin");
    await expect(linkedin).toHaveAttribute(
      "href",
      new RegExp(`linkedin\\.com/sharing/share-offsite/\\?url=.*${expectedUrlFragment}`),
    );

    const x = rail.getByTestId("share-x");
    const xHref = await x.getAttribute("href");
    expect(xHref).toMatch(/twitter\.com\/intent\/tweet\?url=/);
    expect(xHref).toContain(expectedUrlFragment);
    // Title should be encoded into the `text=` param so X pre-fills the tweet.
    expect(xHref).toContain(`text=${encodeURIComponent(post.title)}`);

    const facebook = rail.getByTestId("share-facebook");
    await expect(facebook).toHaveAttribute(
      "href",
      new RegExp(`facebook\\.com/sharer/sharer\\.php\\?u=.*${expectedUrlFragment}`),
    );

    // All three social buttons should open in a new tab with safe rel.
    for (const target of [linkedin, x, facebook]) {
      await expect(target).toHaveAttribute("target", "_blank");
      await expect(target).toHaveAttribute("rel", /noreferrer|noopener/);
    }

    // Copy-link button is always present.
    await expect(rail.getByTestId("share-copy")).toBeVisible();
  });

  test("event-detail share rail keeps the original Facebook / X / LinkedIn target set (no copy/native)", async ({
    page,
  }) => {
    const res = await page.request.get("/api/events?limit=1");
    test.skip(!res.ok(), "Events API unavailable in target environment");
    const body = (await res.json()) as { items?: Array<{ slug: string }> };
    const slug = body.items?.[0]?.slug;
    test.skip(!slug, "No events in target environment");
    if (!slug) return;

    await page.goto(`/events/${slug}`);
    const rail = page.getByTestId("share-rail-event");
    await expect(rail).toBeVisible();

    // The pre-#239 event-detail rail rendered Facebook, X, LinkedIn —
    // and nothing else. Lock that visual contract so the shared
    // component can't accidentally regress event-detail by changing
    // its defaults.
    await expect(rail.getByTestId("share-facebook")).toBeVisible();
    await expect(rail.getByTestId("share-x")).toBeVisible();
    await expect(rail.getByTestId("share-linkedin")).toBeVisible();
    await expect(rail.getByTestId("share-copy")).toHaveCount(0);
    await expect(rail.getByTestId("share-native")).toHaveCount(0);
  });
});
