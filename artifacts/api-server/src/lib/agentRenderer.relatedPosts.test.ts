/**
 * Verifies that renderInsightDetail appends a "Related posts" section
 * containing `<a href="/insights/...">` links when the current post has
 * published category siblings, and omits the section gracefully when it does
 * not.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:agent-renderer-related
 *
 * Uses --experimental-test-module-mocks to replace @workspace/db so the
 * suite runs without a live database connection.
 */

// Prevent any real DB pool from opening.
process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost:5432/mock_test";
process.env["EMAIL_DISABLED"] = "1";
// Make siteOrigin() deterministic.
process.env["SITE_URL"] = "https://www.synozur.com";

import test, { mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Sequential DB mock — shared call queue across all select() calls
// ---------------------------------------------------------------------------

/**
 * Each call to renderInsightDetail issues up to seven sequential DB queries:
 *   1. Fetch post row            — .where().limit()
 *   2. Fetch first category      — .where().limit()
 *   3. Fetch sibling postIds     — .where() (awaited directly)
 *   4. Fetch related posts       — .where() (awaited directly, via fetchPublishedByIds)
 *        fetchPublishedByIds reorders results via Map keyed by `id`; fixture
 *        rows MUST include matching `id` fields or they are filtered out.
 *   — When category yields fewer than 3 related posts, tag-based fallback runs:
 *   5. Fetch tag IDs for post    — .where() (awaited directly)
 *   6. Fetch sibling postIds by tags — .where() (awaited directly)
 *   7. Fetch tag-related posts   — .where() (awaited directly, fetchPublishedByIds)
 *
 * `state.queue` is pre-loaded before each test; each terminal call pops the
 * next entry. An empty queue returns `[]` (safe for optional queries).
 *
 * Inserting `DB_THROW` into the queue causes the corresponding query to
 * reject, exercising the catch/degradation path in renderInsightDetail.
 */
const DB_THROW = Symbol("DB_THROW");
type QueueEntry = unknown[] | typeof DB_THROW;
const state: { queue: QueueEntry[] } = { queue: [] };

function consume(): Promise<unknown[]> {
  const r = state.queue.shift();
  if (r === DB_THROW) return Promise.reject(new Error("Simulated DB error"));
  return Promise.resolve((r as unknown[] | undefined) ?? []);
}

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        // Awaitable directly — used by the sibling query (no .limit() or .orderBy())
        then: (
          res: (v: unknown[]) => unknown,
          rej?: (e: unknown) => unknown,
        ) => consume().then(res, rej),
        // Queries that end with .where().limit()
        limit: () => consume(),
        // Queries that end with .where().orderBy().limit()
        orderBy: () => ({ limit: () => consume() }),
      }),
    }),
  }),
};

// ---------------------------------------------------------------------------
// Mock @workspace/db before importing the module under test.
// Every symbol imported by agentRenderer.ts or ogResolver.ts must be present.
// ---------------------------------------------------------------------------
const T = {}; // table stub — the mock db ignores .from() args

await mock.module("@workspace/db", {
  namedExports: {
    db: mockDb,
    // agentRenderer imports
    postsTable: T,
    servicesTable: T,
    solutionsTable: T,
    teamMembersTable: T,
    eventsTable: T,
    whitePapersTable: T,
    faqCategoriesTable: T,
    faqItemsTable: T,
    caseStudiesTable: T,
    workshopsTable: T,
    collateralTable: T,
    modelsTable: T,
    applicationsTable: T,
    aboutValuesTable: T,
    jobPostingsTable: T,
    postCategories: T,
    categoriesTable: T,
    postTags: T,
    tagsTable: T,
    // ogResolver additional imports
    mediaTable: T,
    siteSettingsTable: T,
    polarisEpisodesTable: T,
    landingPagesTable: T,
    assetsTable: T,
    contentParentPagesTable: T,
    // pool (ogResolver / others may import)
    pool: { end: async () => {} },
  },
});

// Import AFTER mock.module so agentRenderer picks up the mocked db.
const { renderInsightDetail } = await import("./agentRenderer.js");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

import type { OgData } from "./ogResolver.js";

const og: OgData = {
  title: "AI in the Modern Workplace",
  description: "How AI tools reshape enterprise workflows.",
  image: "https://www.synozur.com/og/ai-modern-workplace.jpg",
  ogType: "article",
  url: "https://www.synozur.com/insights/ai-modern-workplace",
};

const ORIGIN = "https://www.synozur.com";

/** A published post row returned by the first query. */
const postRow = {
  id: "post-abc-123",
  excerpt: "A short summary.",
  bodyHtml: "<p>Body content here.</p>",
  publishedAt: new Date("2025-06-01T00:00:00Z"),
};

/** Category join row returned by the second query. */
const catRow = { categoryId: "cat-xyz-456" };

/** Sibling join rows returned by the third query (includes the current post). */
const siblingRows = [
  { postId: "post-abc-123" }, // the current post — must be filtered out
  { postId: "post-sibling-1" },
  { postId: "post-sibling-2" },
];

/**
 * Related post rows returned by fetchPublishedByIds (query 4).
 * IDs must match the eligible siblingIds so the internal Map lookup succeeds.
 */
const relatedRows = [
  { id: "post-sibling-1", title: "Copilot for Work", slug: "copilot-for-work", excerpt: "Copilot tips." },
  { id: "post-sibling-2", title: "Teams AI Features", slug: "teams-ai-features", excerpt: null },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("renders related-post links when the post has published category siblings", async () => {
  state.queue = [
    [postRow],      // query 1: post lookup
    [catRow],       // query 2: category lookup
    siblingRows,    // query 3: sibling postIds
    relatedRows,    // query 4: related posts
  ];

  const html = await renderInsightDetail("ai-modern-workplace", og, ORIGIN);

  // Main post content is present.
  assert.ok(html.includes("<h1>AI in the Modern Workplace</h1>"), "h1 present");
  assert.ok(html.includes("<article>"), "article wrapper present");

  // Related section heading.
  assert.ok(html.includes("Related posts"), "related posts heading present");
  assert.ok(
    html.includes('aria-label="Related posts"'),
    "section has accessible label",
  );

  // Links to sibling posts.
  assert.ok(
    html.includes('<a href="https://www.synozur.com/insights/copilot-for-work">'),
    "link to copilot-for-work present",
  );
  assert.ok(
    html.includes('<a href="https://www.synozur.com/insights/teams-ai-features">'),
    "link to teams-ai-features present",
  );
  assert.ok(html.includes("Copilot for Work"), "title of first related post present");
  assert.ok(html.includes("Teams AI Features"), "title of second related post present");
});

test("omits the related section when the post has no category membership", async () => {
  state.queue = [
    [postRow], // query 1: post lookup
    [],        // query 2: no category row → catRow is undefined
    // queries 3 & 4 are never issued
  ];

  const html = await renderInsightDetail("ai-modern-workplace", og, ORIGIN);

  assert.ok(html.includes("<h1>AI in the Modern Workplace</h1>"), "h1 present");
  assert.ok(!html.includes("Related posts"), "no related section when no category");
  assert.ok(!html.includes("/insights/copilot-for-work"), "no related links");
});

test("omits the related section when the only category sibling is the post itself", async () => {
  state.queue = [
    [postRow],                              // query 1: post lookup
    [catRow],                               // query 2: category found
    [{ postId: "post-abc-123" }],           // query 3: only sibling is itself
    // query 4 not issued (siblingIds.length === 0 after filter)
  ];

  const html = await renderInsightDetail("ai-modern-workplace", og, ORIGIN);

  assert.ok(html.includes("<h1>AI in the Modern Workplace</h1>"), "h1 present");
  assert.ok(!html.includes("Related posts"), "no related section when no other siblings");
});

test("omits the related section when published siblings exist but none pass the publish window", async () => {
  state.queue = [
    [postRow],      // query 1: post lookup
    [catRow],       // query 2: category found
    siblingRows,    // query 3: sibling IDs exist
    [],             // query 4: none pass publish-window filter
  ];

  const html = await renderInsightDetail("ai-modern-workplace", og, ORIGIN);

  assert.ok(html.includes("<h1>AI in the Modern Workplace</h1>"), "h1 present");
  assert.ok(!html.includes("Related posts"), "no related section when related query returns empty");
});

test("returns empty string when the post slug is not found", async () => {
  state.queue = [
    [], // query 1: no post row
  ];

  const html = await renderInsightDetail("nonexistent-slug", og, ORIGIN);

  assert.strictEqual(html, "", "returns empty string for missing post");
});

test("degrades gracefully if the related-post DB query throws", async () => {
  // DB_THROW causes consume() to return a rejected promise, which bubbles up
  // inside renderInsightDetail's try block for the related-post section.
  // The catch block should absorb the error and still return the post body.
  state.queue = [
    [postRow],  // query 1: post found
    DB_THROW,   // query 2: category lookup rejects — triggers the catch block
  ];

  const html = await renderInsightDetail("ai-modern-workplace", og, ORIGIN);

  assert.ok(html.includes("<h1>AI in the Modern Workplace</h1>"), "post content still rendered after DB error");
  assert.ok(!html.includes("Related posts"), "no related section when DB throws");
});

test("supplements with tag-based posts when category has no membership", async () => {
  // The post has no category. Tag fallback fires and yields 2 related posts.
  //
  // Queue:
  //   1. post lookup
  //   2. no catRow (empty) — skips category path
  //   3. tagRows for current post — 2 tags
  //   4. tagSiblingRows — post-tag-a appears twice (2 shared tags), post-tag-b once
  //   5. fetchPublishedByIds for tag candidates — returns the two tag-related posts
  state.queue = [
    [postRow],   // query 1: post
    [],          // query 2: no category → catRow undefined
    // tag fallback (related.length = 0 < 3)
    [{ tagId: "tag-alpha" }, { tagId: "tag-beta" }],              // query 3: tag IDs
    [{ postId: "post-tag-a" }, { postId: "post-tag-a" }, { postId: "post-tag-b" }], // query 4: tag siblings (overlap)
    [                                                              // query 5: published tag posts
      { id: "post-tag-a", title: "Tag Article A", slug: "tag-article-a", excerpt: "Tag A." },
      { id: "post-tag-b", title: "Tag Article B", slug: "tag-article-b", excerpt: null },
    ],
  ];

  const html = await renderInsightDetail("ai-modern-workplace", og, ORIGIN);

  assert.ok(html.includes("<h1>AI in the Modern Workplace</h1>"), "h1 present");
  assert.ok(html.includes("Related posts"), "related posts section rendered from tag fallback");
  assert.ok(
    html.includes('href="https://www.synozur.com/insights/tag-article-a"'),
    "link to tag-article-a present",
  );
  assert.ok(
    html.includes('href="https://www.synozur.com/insights/tag-article-b"'),
    "link to tag-article-b present",
  );
  assert.ok(html.includes("Tag Article A"), "title of tag-related post A present");
  assert.ok(html.includes("Tag Article B"), "title of tag-related post B present");
});
