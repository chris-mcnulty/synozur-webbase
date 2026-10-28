/**
 * Crawlability integration tests for Polaris podcast episode pages.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:polaris-crawlability
 *
 * Confirms two invariants that a future visibility-filter change or
 * agentRenderer edit could silently break:
 *
 *   1. SITEMAP — `collectEntries()` emits at least one `/polaris/:slug` URL
 *      when a published episode exists. Relies on the real DATABASE_URL so
 *      the actual Drizzle query (filters, joins, ordering) is exercised.
 *
 *   2. AGENT RENDERER — `buildAgentPageHtml('/polaris/:slug')` returns a
 *      non-empty HTML document that contains the episode title and summary,
 *      so crawlers receive real content rather than the bare SPA shell.
 *
 * Each test run provisions a throwaway episode scoped by a per-run tag and
 * deletes it on teardown so the test is safe to run against any environment
 * (including CI) without leaving orphan rows.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";
import { db, pool, polarisEpisodesTable } from "@workspace/db";
import { collectEntries } from "../routes/seo.js";
import { buildAgentPageHtml } from "./agentRenderer.js";

// Unique per test-run so parallel runs on the same DB don't collide.
const TAG = `crawlability-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EPISODE_SLUG = `polaris-crawlability-ep-${TAG}`;
const EPISODE_TITLE = `Crawlability Test Episode ${TAG}`;
const EPISODE_SUMMARY = `This is the summary for the crawlability integration test episode tagged ${TAG}.`;

let insertedId: string | null = null;

test.before(async () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
  const [row] = await db
    .insert(polarisEpisodesTable)
    .values({
      slug: EPISODE_SLUG,
      title: EPISODE_TITLE,
      episodeNumber: 9999,
      summary: EPISODE_SUMMARY,
      audioUrl: "",
      artworkUrl: "",
      status: "published",
      active: true,
      publishedAt: past,
    })
    .returning({ id: polarisEpisodesTable.id });
  insertedId = row.id;
});

test.after(async () => {
  if (insertedId) {
    await db
      .delete(polarisEpisodesTable)
      .where(eq(polarisEpisodesTable.id, insertedId));
  }
  await pool.end();
});

// ─── 1. Sitemap ────────────────────────────────────────────────────────────────

test("polaris sitemap: collectEntries includes /polaris/:slug for a published episode", async () => {
  const entries = await collectEntries();
  const locs = entries.map((e) => e.loc);

  const match = locs.find((loc) => loc.includes(`/polaris/${EPISODE_SLUG}`));
  assert.ok(
    match,
    `Expected a sitemap entry containing /polaris/${EPISODE_SLUG} but none was found.\n` +
      `Polaris entries found: ${locs.filter((l) => l.includes("/polaris/")).join(", ") || "(none)"}`,
  );
});

test("polaris sitemap: /polaris/:slug entry is an absolute URL", async () => {
  const entries = await collectEntries();
  const match = entries.find((e) => e.loc.includes(`/polaris/${EPISODE_SLUG}`));
  assert.ok(match, "Expected entry not found (prerequisite)");
  assert.match(
    match.loc,
    /^https?:\/\//,
    `Sitemap loc must be an absolute URL, got: ${match.loc}`,
  );
});

// ─── 2. Agent renderer ────────────────────────────────────────────────────────

test("polaris agent renderer: /polaris/:slug returns a non-empty HTML document", async () => {
  const html = await buildAgentPageHtml(`/polaris/${EPISODE_SLUG}`);
  assert.ok(html.length > 0, "Expected non-empty HTML document");
  assert.match(html, /^<!DOCTYPE html>/i, "Expected a complete HTML document");
  assert.ok(html.includes("<html"), "Expected <html> element");
  assert.ok(html.includes("<main>"), "Expected <main> content block");
});

test("polaris agent renderer: /polaris/:slug HTML contains the episode title", async () => {
  const html = await buildAgentPageHtml(`/polaris/${EPISODE_SLUG}`);
  assert.ok(
    html.includes(EPISODE_TITLE),
    `Expected episode title "${EPISODE_TITLE}" in rendered HTML`,
  );
});

test("polaris agent renderer: /polaris/:slug HTML contains the episode summary", async () => {
  const html = await buildAgentPageHtml(`/polaris/${EPISODE_SLUG}`);
  assert.ok(
    html.includes(EPISODE_SUMMARY),
    `Expected episode summary in rendered HTML.\nSummary: ${EPISODE_SUMMARY}`,
  );
});

test("polaris agent renderer: /polaris/:slug includes an <h1> heading", async () => {
  const html = await buildAgentPageHtml(`/polaris/${EPISODE_SLUG}`);
  assert.ok(html.includes("<h1>"), "Expected at least one <h1> in the rendered document");
});

test("polaris agent renderer: /polaris/:slug includes sitemap and llms.txt crawl pointers", async () => {
  const html = await buildAgentPageHtml(`/polaris/${EPISODE_SLUG}`);
  assert.ok(html.includes("/sitemap.xml"), "Expected /sitemap.xml link for outward crawling");
  assert.ok(html.includes("/llms.txt"), "Expected /llms.txt link for agent discovery");
});

test("polaris agent renderer: /polaris/:slug has a canonical link tag", async () => {
  const html = await buildAgentPageHtml(`/polaris/${EPISODE_SLUG}`);
  assert.ok(
    html.includes(`rel="canonical"`),
    "Expected a canonical <link> element",
  );
  assert.ok(
    html.includes(`/polaris/${EPISODE_SLUG}`),
    "Expected canonical URL to reference the episode slug",
  );
});

// ─── 3. Hub listing page (/polaris) ───────────────────────────────────────────

test("polaris agent renderer: /polaris returns a non-empty HTML document", async () => {
  const html = await buildAgentPageHtml("/polaris");
  assert.ok(html.length > 0, "Expected non-empty HTML document");
  assert.match(html, /^<!DOCTYPE html>/i, "Expected a complete HTML document");
  assert.ok(html.includes("<html"), "Expected <html> element");
  assert.ok(html.includes("<main>"), "Expected <main> content block");
});

test("polaris agent renderer: /polaris HTML contains a link to the seeded episode", async () => {
  const html = await buildAgentPageHtml("/polaris");
  assert.ok(
    html.includes(`/polaris/${EPISODE_SLUG}`),
    `Expected hub listing to contain a link to /polaris/${EPISODE_SLUG} but none was found.`,
  );
});

test("polaris agent renderer: /polaris HTML contains the seeded episode title", async () => {
  const html = await buildAgentPageHtml("/polaris");
  assert.ok(
    html.includes(EPISODE_TITLE),
    `Expected hub listing to contain episode title "${EPISODE_TITLE}"`,
  );
});

test("polaris agent renderer: /polaris includes sitemap and llms.txt crawl pointers", async () => {
  const html = await buildAgentPageHtml("/polaris");
  assert.ok(html.includes("/sitemap.xml"), "Expected /sitemap.xml link for outward crawling");
  assert.ok(html.includes("/llms.txt"), "Expected /llms.txt link for agent discovery");
});
