/**
 * #254 — unit test for the "archive triggers a submission" path.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:seo-unpublish
 *
 * Confirms that calling `submitIfTransitionedToGone` for a row that flips
 * from `published` → `archived` writes one
 * `seo_unpublish_submissions` row per channel (IndexNow / Google Indexing /
 * Bing Webmaster). The submission credentials are intentionally cleared
 * before importing the helper so every channel records `ok=false` with a
 * "not configured" reason — no live HTTP traffic leaves the test process.
 *
 * Also asserts the no-op cases:
 *   - already-gone → no rows.
 *   - still-live → no rows.
 */
process.env["EMAIL_DISABLED"] = "1";
process.env["INDEXNOW_KEY"] = "";
process.env["GOOGLE_INDEXING_SA_JSON"] = "";
process.env["BING_API_KEY"] = "";
process.env["BING_SITE_URL"] = "";
process.env["SITE_URL"] = "https://www.synozur.com";

import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, gte } from "drizzle-orm";
import { db, pool, seoUnpublishSubmissionsTable } from "@workspace/db";
import { submitIfTransitionedToGone, isGoneState } from "../lib/seoUnpublishSubmit";
import {
  googleNotifyPayload,
  __setGoogleClientFactoryForTesting,
} from "../lib/seoSubmit";

const entityId = `unpublish-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const slug = `unpublish-test-${Date.now()}`;
const startedAt = new Date();

test.after(async () => {
  await db
    .delete(seoUnpublishSubmissionsTable)
    .where(
      and(
        eq(seoUnpublishSubmissionsTable.entityId, entityId),
        gte(seoUnpublishSubmissionsTable.submittedAt, startedAt),
      ),
    );
  await pool.end();
});

test("isGoneState recognises archived / unpublishedAt / inactive (opt-in)", () => {
  assert.equal(isGoneState({ status: "published" }), false);
  assert.equal(isGoneState({ status: "archived" }), true);
  assert.equal(
    isGoneState({ unpublishedAt: new Date(Date.now() - 1000) }),
    true,
  );
  assert.equal(
    isGoneState({ unpublishedAt: new Date(Date.now() + 60_000) }),
    false,
  );
  // active=false is NOT a gone signal by default (404, not 410).
  assert.equal(isGoneState({ active: false }), false);
  // ...but workshops (and any other 410-on-inactive caller) opt in.
  assert.equal(
    isGoneState({ active: false }, { treatInactiveAsGone: true }),
    true,
  );
  assert.equal(
    isGoneState({ active: true }, { treatInactiveAsGone: true }),
    false,
  );
});

test("archive transition writes one row per channel", async () => {
  const result = await submitIfTransitionedToGone({
    entityType: "post",
    entityId,
    slug,
    publicPath: `/insights/${slug}`,
    before: { status: "published" },
    after: { status: "archived" },
  });

  assert.ok(result, "helper should return a SubmitBundle on transition");
  assert.equal(result!.results.length, 3, "expected one result per channel");

  const rows = await db
    .select()
    .from(seoUnpublishSubmissionsTable)
    .where(eq(seoUnpublishSubmissionsTable.entityId, entityId));
  assert.equal(rows.length, 3, "expected one persisted row per channel");

  const channels = rows.map((r) => r.channel).sort();
  assert.deepEqual(
    channels,
    ["bing-webmaster", "google-indexing", "indexnow"],
    "expected one row for each configured submission channel",
  );

  for (const r of rows) {
    assert.equal(r.entityType, "post");
    assert.equal(r.slug, slug);
    assert.equal(r.url, `https://www.synozur.com/insights/${slug}`);
    // With env credentials cleared, every channel should record a non-ok
    // result so the admin readout truthfully reports "not configured".
    assert.equal(r.ok, false);
    assert.ok(r.error && r.error.length > 0, "skip reason should be recorded");
  }
});

test("no-op when the row was already gone before this save", async () => {
  const before = await db
    .select()
    .from(seoUnpublishSubmissionsTable)
    .where(eq(seoUnpublishSubmissionsTable.entityId, entityId));
  const result = await submitIfTransitionedToGone({
    entityType: "post",
    entityId,
    slug,
    publicPath: `/insights/${slug}`,
    before: { status: "archived" },
    after: { status: "archived" },
  });
  assert.equal(result, null);
  const after = await db
    .select()
    .from(seoUnpublishSubmissionsTable)
    .where(eq(seoUnpublishSubmissionsTable.entityId, entityId));
  assert.equal(after.length, before.length, "no new rows should be inserted");
});

test("googleNotifyPayload uses URL_DELETED in delete mode", () => {
  assert.deepEqual(
    googleNotifyPayload("https://www.synozur.com/insights/foo", "delete"),
    { url: "https://www.synozur.com/insights/foo", type: "URL_DELETED" },
  );
  assert.deepEqual(
    googleNotifyPayload("https://www.synozur.com/insights/foo", "publish"),
    { url: "https://www.synozur.com/insights/foo", type: "URL_UPDATED" },
  );
  assert.equal(
    googleNotifyPayload("https://x/y").type,
    "URL_UPDATED",
    "default mode should be publish (URL_UPDATED)",
  );
});

test("unpublish transition sends URL_DELETED to Google", async () => {
  // Stub the Google client factory and capture every request payload so
  // we can prove the unpublish path actually emits URL_DELETED.
  const calls: { url: string; method: string; data: unknown }[] = [];
  process.env["GOOGLE_INDEXING_SA_JSON"] = JSON.stringify({
    type: "service_account",
    client_email: "stub@example.invalid",
    private_key: "stub",
  });
  __setGoogleClientFactoryForTesting(async () => {
    return {
      // Minimal shape — submitGoogleIndexingWithConcurrency only calls
      // `request`, treating any non-throw as success.
      request: async (opts: { url: string; method: string; data: unknown }) => {
        calls.push({ url: opts.url, method: opts.method, data: opts.data });
        return { status: 200, data: {} } as unknown as never;
      },
    } as never;
  });

  const stubEntityId = `${entityId}-google-stub`;
  try {
    const result = await submitIfTransitionedToGone({
      entityType: "post",
      entityId: stubEntityId,
      slug,
      publicPath: `/insights/${slug}`,
      before: { status: "published" },
      after: { status: "archived" },
    });
    assert.ok(result, "helper should return a SubmitBundle");
    assert.equal(calls.length, 1, "expected exactly one Google request");
    assert.equal(
      calls[0].url,
      "https://indexing.googleapis.com/v3/urlNotifications:publish",
    );
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].data, {
      url: `https://www.synozur.com/insights/${slug}`,
      type: "URL_DELETED",
    });

    const googleRow = await db
      .select()
      .from(seoUnpublishSubmissionsTable)
      .where(
        and(
          eq(seoUnpublishSubmissionsTable.entityId, stubEntityId),
          eq(seoUnpublishSubmissionsTable.channel, "google-indexing"),
        ),
      );
    assert.equal(googleRow.length, 1);
    assert.equal(googleRow[0].ok, true, "stubbed Google call should record ok");
  } finally {
    __setGoogleClientFactoryForTesting(null);
    process.env["GOOGLE_INDEXING_SA_JSON"] = "";
    await db
      .delete(seoUnpublishSubmissionsTable)
      .where(eq(seoUnpublishSubmissionsTable.entityId, stubEntityId));
  }
});

test("submits both old and new URLs when slug changes during unpublish", async () => {
  const calls: { data: { url: string; type: string } }[] = [];
  process.env["GOOGLE_INDEXING_SA_JSON"] = JSON.stringify({
    type: "service_account",
    client_email: "stub@example.invalid",
    private_key: "stub",
  });
  __setGoogleClientFactoryForTesting(async () => ({
    request: async (opts: { data: { url: string; type: string } }) => {
      calls.push({ data: opts.data });
      return { status: 200, data: {} } as unknown as never;
    },
  } as never));

  const stubEntityId = `${entityId}-slug-change`;
  const oldSlug = `${slug}-old`;
  const newSlug = `${slug}-new`;
  try {
    await submitIfTransitionedToGone({
      entityType: "post",
      entityId: stubEntityId,
      slug: oldSlug,
      publicPath: `/insights/${oldSlug}`,
      alsoSubmitPath: `/insights/${newSlug}`,
      before: { status: "published" },
      after: { status: "archived" },
    });
    assert.equal(calls.length, 2, "should submit both old and new URLs");
    const urls = calls.map((c) => c.data.url).sort();
    assert.deepEqual(urls, [
      `https://www.synozur.com/insights/${newSlug}`,
      `https://www.synozur.com/insights/${oldSlug}`,
    ]);
    for (const c of calls) {
      assert.equal(c.data.type, "URL_DELETED");
    }
  } finally {
    __setGoogleClientFactoryForTesting(null);
    process.env["GOOGLE_INDEXING_SA_JSON"] = "";
    await db
      .delete(seoUnpublishSubmissionsTable)
      .where(eq(seoUnpublishSubmissionsTable.entityId, stubEntityId));
  }
});

test("no-op when the row is still live", async () => {
  const before = await db
    .select()
    .from(seoUnpublishSubmissionsTable)
    .where(eq(seoUnpublishSubmissionsTable.entityId, entityId));
  const result = await submitIfTransitionedToGone({
    entityType: "post",
    entityId,
    slug,
    publicPath: `/insights/${slug}`,
    before: { status: "draft" },
    after: { status: "published" },
  });
  assert.equal(result, null);
  const after = await db
    .select()
    .from(seoUnpublishSubmissionsTable)
    .where(eq(seoUnpublishSubmissionsTable.entityId, entityId));
  assert.equal(after.length, before.length, "no new rows should be inserted");
});
