import { test, expect, type Page } from "@playwright/test";

// Real form, picker and React Query mutations; disposable per-test API
// fixtures. Every API request is intercepted: no credentials, DB changes,
// Graph appointments, upload, or email are possible.
const original = "/api/storage/objects/uploads/original.png?source=library";
const selected = "/api/storage/objects/uploads/selected.webp?source=library";
const siteDefault = "/api/storage/objects/uploads/site-default.png";
const calendar = {
  embedUrl: "https://bookings.cloud.microsoft/owa/calendar/fixture/bookings/",
  msBusinessId: "fixture@tenant.onmicrosoft.com",
  msDefaultServiceId: "fixture-service", msTimezone: "America/Vancouver",
  startsAt: "2020-01-01T12:00:00.000Z", endsAt: "2099-01-01T12:00:00.000Z",
  scope: "conference", displayOrder: 17, active: true,
};

async function fixture(page: Page, image: string | null = original) {
  let stored = {
    ...calendar, id: "booking-fixture", slug: "booking-fixture", title: "Fixture Booking",
    teaser: null, descriptionHtml: null, seoTitle: null, seoDescription: null,
    ogImageUrl: image, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const writes: Record<string, unknown>[] = [];
  const forbidden: string[] = [];
  const user = { id: "fixture-user", email: "fixture@example.test", roles: ["admin"], displayName: "Fixture Admin" };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let json: unknown = {};
    if (path === "/api/auth/session") json = { signedIn: true, user };
    else if (path === "/api/auth/me") json = user;
    else if (path === "/api/admin/me") json = { authorized: true, email: user.email };
    else if (path === "/api/site-settings") json = {
      seoDefaultOgImageUrl: siteDefault,
      seoDefaultDescription: "Configured site-default description",
    };
    else if (path === "/api/admin/bookings/booking-fixture") {
      if (req.method() === "PATCH") {
        const body = req.postDataJSON();
        writes.push(body);
        stored = { ...stored, ...body };
      } else if (req.method() !== "GET") forbidden.push(`${req.method()} ${path}`);
      json = stored;
    } else if (path === "/api/admin/bookings") json = { items: [stored] };
    else if (path === "/api/admin/bookings/graph-status") json = { configured: false, connected: false };
    else if (path === "/api/cms/media") json = { items: [
      { id: "selected-image", publicUrl: selected, storageKey: "/objects/uploads/wrong-key.png",
        mime: "image/webp", altText: "Selected share image", originalName: "Selected image.webp" },
      { id: "storage-only-image", publicUrl: "", storageKey: "/objects/uploads/storage-only.png",
        mime: "image/png", altText: "Storage-only share image", originalName: "Storage only.png" },
      { id: "not-an-image", publicUrl: "/fixture.pdf", storageKey: "/fixture.pdf",
        mime: "application/pdf", altText: "Document", originalName: "Not an image.pdf" },
    ], total: 3 };
    else if (path === "/api/cms/asset-categories") json = { items: [] };
    else if (path.startsWith("/api/storage/")) {
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#314466"/></svg>' });
      return;
    } else {
      const telemetry = ["/api/traffic/collect", "/api/metrics/cwv", "/api/csp/report"];
      if ((!telemetry.includes(path) && req.method() !== "GET") || /bookings.*(appointments|services|slots|graph)/.test(path)) {
        forbidden.push(`${req.method()} ${path}`);
      }
      json = { items: [] };
    }
    await route.fulfill({ json });
  });
  return {
    writes, read: () => structuredClone(stored),
    assertSafe: () => expect(forbidden).toEqual([]),
  };
}

const editPath = "/admin/people/bookings/booking-fixture";
const preview = (page: Page) => page.getByTestId("social-card-preview");
async function open(page: Page, url: string | null) {
  await page.goto(editPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("input-booking-og-image")).toHaveValue(url ?? "");
  await expect(preview(page)).toBeVisible();
}
async function expectPreview(page: Page, url: string) {
  const expected = new URL(url, "https://fixture.test");
  expected.searchParams.set("w", "1200");
  expected.searchParams.set("fmt", "jpeg");
  await expect(preview(page).locator("img")).toHaveAttribute("src", `${expected.pathname}${expected.search}`);
}
async function save(page: Page) {
  await page.getByTestId("button-save").click();
  await expect(page).toHaveURL(/\/admin\/people\/bookings$/);
}
function unchanged(row: Record<string, unknown>) {
  for (const [key, value] of Object.entries(calendar)) expect(row[key], key).toEqual(value);
}

test("image-only picker saves original URL and reopens without a media ID", async ({ page }) => {
  const f = await fixture(page);
  await open(page, original);
  await expectPreview(page, original);
  await page.getByTestId("button-booking-og-image-picker").click();
  await expect(page.getByTestId("media-item-selected-image")).toBeVisible();
  await expect(page.getByTestId("media-item-not-an-image")).toHaveCount(0);
  await page.getByTestId("media-item-selected-image").click();
  await page.getByTestId("button-lightbox-select").click();
  await expect(page.getByTestId("input-booking-og-image")).toHaveValue(selected);
  await expectPreview(page, selected);
  expect(f.writes).toHaveLength(0);
  expect(f.read().ogImageUrl).toBe(original);
  await save(page);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].ogImageUrl).toBe(selected);
  expect(f.writes[0]).not.toHaveProperty("ogImageId");
  unchanged(f.writes[0]);
  unchanged(f.read());
  await open(page, selected);
  await expectPreview(page, selected);
  f.assertSafe();
});

test("picker cancellation and unsaved clears never change stored metadata", async ({ page }) => {
  const f = await fixture(page);
  const before = f.read();
  await open(page, original);
  await page.getByTestId("button-booking-og-image-picker").click();
  await page.getByTestId("media-item-selected-image").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("button-media-cancel").click();
  await expect(page.getByTestId("input-booking-og-image")).toHaveValue(original);
  await expectPreview(page, original);
  await page.getByTestId("button-booking-og-image-clear").click();
  await expect(page.getByTestId("input-booking-og-image")).toHaveValue("");
  await expectPreview(page, siteDefault);
  await expect(preview(page)).toContainText("Configured site-default description");
  expect(f.read()).toEqual(before);
  expect(f.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await open(page, original);
  await expectPreview(page, original);
  expect(f.read()).toEqual(before);
  expect(f.writes).toHaveLength(0);
  f.assertSafe();
});

test("explicit clear saves null and reopens with configured site defaults", async ({ page }) => {
  const f = await fixture(page);
  await open(page, original);
  await page.getByTestId("button-booking-og-image-clear").click();
  expect(f.read().ogImageUrl).toBe(original);
  await save(page);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].ogImageUrl).toBeNull();
  unchanged(f.writes[0]);
  unchanged(f.read());
  await open(page, null);
  await expectPreview(page, siteDefault);
  await expect(preview(page)).toContainText("Configured site-default description");
  f.assertSafe();
});

test("legacy external URL-only booking previews and saves without a media lookup", async ({ page }) => {
  const legacy = "https://images.example.test/legacy.jpg";
  await page.route("https://images.example.test/**", (route) => route.fulfill({ status: 204 }));
  const f = await fixture(page, legacy);
  await open(page, legacy);
  await expect(preview(page).locator("img")).toHaveAttribute("src", legacy);
  await page.getByTestId("input-seoTitle").fill("Legacy title");
  await save(page);
  expect(f.writes[0].ogImageUrl).toBe(legacy);
  unchanged(f.read());
  await open(page, legacy);
  await expect(preview(page).locator("img")).toHaveAttribute("src", legacy);
  f.assertSafe();
});

test("storage-key-only Media Library item resolves to original storage URL", async ({ page }) => {
  const f = await fixture(page, null);
  await open(page, null);
  await page.getByTestId("button-booking-og-image-picker").click();
  await page.getByTestId("media-item-storage-only-image").click();
  await page.getByTestId("button-lightbox-select").click();
  const resolved = "/api/storage/objects/uploads/storage-only.png";
  await expect(page.getByTestId("input-booking-og-image")).toHaveValue(resolved);
  await save(page);
  expect(f.writes[0].ogImageUrl).toBe(resolved);
  unchanged(f.read());
  f.assertSafe();
});
