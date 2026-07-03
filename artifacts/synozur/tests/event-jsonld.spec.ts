import { test, expect } from "@playwright/test";

/**
 * Task #374 — Event rich results: correct description in Google's validator.
 *
 * EventJsonLd.description resolves as:
 *   event.seoDescription ?? event.teaser ?? event.description ?? null
 *
 * These tests verify the full production path: we mock the public event
 * API response, navigate to the real event-detail page, and inspect the
 * <script type="application/ld+json"> that EventJsonLd injects into
 * document.head.  This exercises event-detail.tsx's fallback chain and
 * EventJsonLd's DOM injection in one shot — no duplicated logic in test code.
 */

const TEST_SLUG = "test-seo-event-374";
const EVENT_URL = `/events/${TEST_SLUG}`;
const API_PATTERN = `**/api/events/${TEST_SLUG}`;

/** Minimal valid PublicEvent payload. */
function mockEvent(overrides: {
  seoDescription?: string | null;
  teaser?: string | null;
  description?: string | null;
} = {}) {
  return {
    id: 9374,
    title: "Test SEO Event",
    slug: TEST_SLUG,
    startDate: "2027-06-01T14:00:00.000Z",
    endDate: null,
    location: null,
    teaser: overrides.teaser ?? null,
    description: overrides.description ?? null,
    registrationUrl: null,
    registrationStatus: "OPEN",
    eventType: "Conference",
    status: "PUBLISHED",
    imageUrl: null,
    recordingVideoId: null,
    recordingVideoSlug: null,
    recordingVideoUrl: null,
    recordingVideoTitle: null,
    speakers: [],
    hasSessions: false,
    timezone: null,
    seoTitle: null,
    seoDescription: overrides.seoDescription ?? null,
  };
}

/** Read and parse the EventJsonLd script injected by the component. */
async function readEventJsonLd(
  page: import("@playwright/test").Page,
): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const script = document.head.querySelector(
      'script[type="application/ld+json"]#event-jsonld',
    );
    if (!script) return null;
    try {
      return JSON.parse(script.textContent ?? "") as Record<string, unknown>;
    } catch {
      return null;
    }
  });
}

test.describe("Event JSON-LD description resolution (#374)", () => {
  test("seoDescription is used as JSON-LD description when set", async ({ page }) => {
    const SEO_DESCRIPTION = "Authoritative SEO copy for Google rich results.";

    await page.route(API_PATTERN, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          mockEvent({
            seoDescription: SEO_DESCRIPTION,
            teaser: "Short teaser that must NOT appear in JSON-LD",
            description: "Long body copy that must NOT appear in JSON-LD",
          }),
        ),
      });
    });

    await page.goto(EVENT_URL);

    // Wait for the event title to confirm the page rendered correctly.
    await expect(
      page.getByRole("heading", { name: "Test SEO Event", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // Wait for the JSON-LD script to be injected (EventJsonLd runs in useEffect).
    await expect
      .poll(() => readEventJsonLd(page), { timeout: 10_000 })
      .not.toBeNull();

    const data = await readEventJsonLd(page);
    expect(data, "JSON-LD script must be present in document.head").not.toBeNull();
    expect(data!["@type"]).toBe("Event");
    expect(
      data!.description,
      "seoDescription must win over teaser and description in JSON-LD",
    ).toBe(SEO_DESCRIPTION);
  });

  test("teaser is used as JSON-LD description when seoDescription is absent", async ({
    page,
  }) => {
    const TEASER = "Concise teaser that becomes the JSON-LD description.";

    await page.route(API_PATTERN, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          mockEvent({
            seoDescription: null,
            teaser: TEASER,
            description: "Long body that must NOT win over teaser.",
          }),
        ),
      });
    });

    await page.goto(EVENT_URL);

    await expect(
      page.getByRole("heading", { name: "Test SEO Event", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(() => readEventJsonLd(page), { timeout: 10_000 })
      .not.toBeNull();

    const data = await readEventJsonLd(page);
    expect(data, "JSON-LD script must be present in document.head").not.toBeNull();
    expect(data!["@type"]).toBe("Event");
    expect(
      data!.description,
      "teaser must be used in JSON-LD when seoDescription is absent",
    ).toBe(TEASER);
  });
});
