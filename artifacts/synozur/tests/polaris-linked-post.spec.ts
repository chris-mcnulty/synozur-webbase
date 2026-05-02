import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * #212 — Regression coverage for the Polaris episode → blog post link
 * (PR #64). The detail page renders a "Read the post" card whenever the
 * episode's `linkedPost` is non-null; clicking it should navigate to
 * `/insights/:slug`. Episodes without a linked post must not render the
 * card at all.
 *
 * Tests are data-driven against the public API so the suite tracks the
 * environment's content state rather than hard-coding a slug — there is
 * no Polaris-specific entry in `lib/db/src/seed.ts` to anchor on. To
 * keep coverage from silently disappearing if seed data drifts, both
 * legs FAIL (not skip) when no suitable episode is present; restoring
 * coverage then becomes a content-fix and not a quietly-green test.
 */

interface PolarisLinkedPostDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  heroImageUrl: string | null;
  publishedAt: string | null;
}

interface PolarisEpisodeDto {
  id: string;
  slug: string;
  title: string;
  linkedPostId: string | null;
  linkedPost: PolarisLinkedPostDto | null;
}

interface PolarisEpisodeListItem {
  slug: string;
  linkedPostId: string | null;
}

async function listEpisodes(
  request: APIRequestContext,
): Promise<PolarisEpisodeListItem[]> {
  const res = await request.get("/api/polaris/episodes?pageSize=100");
  expect(res.ok(), `GET /api/polaris/episodes failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { items: PolarisEpisodeListItem[] };
  return body.items;
}

async function fetchEpisode(
  request: APIRequestContext,
  slug: string,
): Promise<PolarisEpisodeDto> {
  const res = await request.get(`/api/polaris/episodes/${encodeURIComponent(slug)}`);
  expect(res.ok(), `GET /api/polaris/episodes/${slug} failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as PolarisEpisodeDto;
}

// Walk the episode list and return the first episode whose detail
// payload still has a published, non-null `linkedPost`. The picker
// double-checks the detail call so a stale `linkedPostId` (post was
// later unpublished or soft-deleted) doesn't trip the test.
async function pickEpisodeWithLinkedPost(
  request: APIRequestContext,
): Promise<PolarisEpisodeDto | null> {
  const items = await listEpisodes(request);
  for (const item of items) {
    if (!item.linkedPostId) continue;
    const detail = await fetchEpisode(request, item.slug);
    if (detail.linkedPost) return detail;
  }
  return null;
}

// Defensive escape for slugs used inside RegExp construction. Slugs in
// this codebase pass through toSlug() and shouldn't contain regex
// metacharacters, but locking that down at the test layer keeps the
// assertion robust if the slug rules ever loosen.
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pickEpisodeWithoutLinkedPost(
  request: APIRequestContext,
): Promise<PolarisEpisodeDto | null> {
  const items = await listEpisodes(request);
  for (const item of items) {
    if (item.linkedPostId) continue;
    const detail = await fetchEpisode(request, item.slug);
    if (!detail.linkedPost) return detail;
  }
  return null;
}

test.describe("Polaris episode → linked post card", () => {
  test("renders the linked-post card and navigates to /insights/:slug", async ({
    page,
    request,
  }) => {
    const episode = await pickEpisodeWithLinkedPost(request);
    expect(
      episode,
      "No Polaris episode in this environment has a published linked post — link an episode to a published post via /cms/polaris/episodes/:id (linkedPostId) to restore coverage.",
    ).not.toBeNull();
    const linked = episode!.linkedPost!;

    await page.goto(`/polaris/${episode!.slug}`);

    const card = page.getByTestId("polaris-linked-post-card");
    await expect(card).toBeVisible();
    // The card is rendered as an <a> with an href pointing at the
    // public insight URL. Wouter mounts hrefs as the full path.
    await expect(card).toHaveAttribute("href", `/insights/${linked.slug}`);
    // Title comes from the linked post payload, not the episode.
    await expect(card.getByRole("heading", { name: linked.title })).toBeVisible();

    await card.click();
    await expect(page).toHaveURL(
      new RegExp(`/insights/${escapeRegex(linked.slug)}(?:[/?#]|$)`),
    );
    // The insight detail page renders an h1 with the post title.
    await expect(
      page.getByRole("heading", { level: 1, name: linked.title }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("episode without a linked post renders no card", async ({ page, request }) => {
    const episode = await pickEpisodeWithoutLinkedPost(request);
    expect(
      episode,
      "Every Polaris episode in this environment has a linked post — clear linkedPostId on at least one episode (or import an unlinked one from the feed) to restore the negative-case coverage.",
    ).not.toBeNull();

    await page.goto(`/polaris/${episode!.slug}`);
    // Wait for the detail hero to mount before asserting the card is
    // absent — otherwise the assertion could pass simply because the
    // page is still loading.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("polaris-linked-post-card")).toHaveCount(0);
  });
});
