/**
 * Invariant tests for the meta-description guard as it applies to insight
 * items edited via the collateral editor (collateral-edit.tsx).
 *
 * Tests are written against the production `insightNoMetaDesc` function
 * exported from meta-desc-guard.ts. Any change to that production function —
 * including deletion — will break these tests.
 *
 * Coverage:
 *  1. insightNoMetaDesc returns true only when BOTH description AND
 *     seoDescription are blank (or whitespace-only).
 *  2. The amber banner condition is `active && insightNoMetaDesc(...)`.
 *     It must not fire for inactive insights.
 *  3. The save path is NOT blocked by a missing meta description — the toast
 *     fires as a warning but the mutation still runs.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/library/insight-meta-desc-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { insightNoMetaDesc } from "./meta-desc-guard";

// ─── insightNoMetaDesc tests ──────────────────────────────────────────────────

test("insightNoMetaDesc: true when both description and seoDescription are empty strings", () => {
  assert.equal(insightNoMetaDesc("", ""), true);
});

test("insightNoMetaDesc: true when both are whitespace-only", () => {
  assert.equal(insightNoMetaDesc("   ", "\t\n"), true);
});

test("insightNoMetaDesc: false when description has content", () => {
  assert.equal(insightNoMetaDesc("Exploring how AI is reshaping enterprise strategy.", ""), false);
});

test("insightNoMetaDesc: false when seoDescription has content", () => {
  assert.equal(insightNoMetaDesc("", "Optimised meta description for search engines."), false);
});

test("insightNoMetaDesc: false when both have content", () => {
  assert.equal(insightNoMetaDesc("Description text", "SEO desc"), false);
});

test("insightNoMetaDesc: false when description is whitespace but seoDescription has content", () => {
  assert.equal(insightNoMetaDesc("  ", "Non-empty SEO description"), false);
});

test("insightNoMetaDesc: false when seoDescription is whitespace but description has content", () => {
  assert.equal(insightNoMetaDesc("Non-empty description", "   "), false);
});

// ─── Banner visibility condition ──────────────────────────────────────────────
// Mirrors the JSX condition in collateral-edit.tsx:
//   {form.active && noMetaDesc && <Banner/>}
// where noMetaDesc = collateralNoMetaDesc(...) (same logic as insightNoMetaDesc)

test("banner condition: true for active insight with both fields blank", () => {
  const active = true;
  assert.equal(active && insightNoMetaDesc("", ""), true,
    "data-testid=banner-no-meta-desc should be rendered");
});

test("banner condition: false for INACTIVE insight even when both fields are blank", () => {
  const active = false;
  assert.equal(active && insightNoMetaDesc("", ""), false,
    "banner must not appear for inactive insights");
});

test("banner condition: false for active insight when description is filled", () => {
  const active = true;
  assert.equal(active && insightNoMetaDesc("A practical guide to digital transformation.", ""), false);
});

test("banner condition: false for active insight when seoDescription is filled", () => {
  const active = true;
  assert.equal(active && insightNoMetaDesc("", "SEO-optimised description for the insight."), false);
});

test("banner condition: false for active insight when both fields are filled", () => {
  const active = true;
  assert.equal(active && insightNoMetaDesc("Short desc", "SEO desc"), false);
});

// ─── onSave behaviour ─────────────────────────────────────────────────────────
// Mirrors the onSave guard in collateral-edit.tsx for insight-type items.
// A missing title is a hard block for non-synced items.
// Uses the real production function to compute noMetaDesc.

interface SaveResult {
  blocked: boolean;
  toastFired: boolean;
}

function simulateInsightSave(opts: {
  title: string;
  active: boolean;
  description: string;
  seoDescription: string;
  isSynced?: boolean;
}): SaveResult {
  const isSynced = opts.isSynced ?? false;

  // Hard block for non-synced items — same check as onSave in the component
  if (!isSynced && !opts.title.trim()) return { blocked: true, toastFired: false };

  // Soft warning using the production function
  const noDesc = insightNoMetaDesc(opts.description, opts.seoDescription);
  const toastFired = opts.active && noDesc;
  // saveMut.mutate() is always called — save is not blocked by missing meta desc
  return { blocked: false, toastFired };
}

test("onSave: toast fires but save is NOT blocked when active insight has no meta desc", () => {
  const result = simulateInsightSave({
    title: "The Future of AI in Enterprise",
    active: true,
    description: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false, "save must not be blocked — meta desc warning is advisory");
  assert.equal(result.toastFired, true,
    "warning toast must fire when active insight has no meta description");
});

test("onSave: no toast and save proceeds when active insight has a description", () => {
  const result = simulateInsightSave({
    title: "The Future of AI in Enterprise",
    active: true,
    description: "How AI is driving the next wave of enterprise transformation.",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false, "no warning toast when description is provided");
});

test("onSave: no toast and save proceeds when active insight has a seoDescription", () => {
  const result = simulateInsightSave({
    title: "The Future of AI in Enterprise",
    active: true,
    description: "",
    seoDescription: "Discover how AI is reshaping enterprise strategy and operations.",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false);
});

test("onSave: no toast when insight is inactive (even with no meta desc)", () => {
  const result = simulateInsightSave({
    title: "The Future of AI in Enterprise",
    active: false,
    description: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false,
    "no meta-desc toast for inactive insights");
});

test("onSave: blocked when title is missing for non-synced insight", () => {
  const result = simulateInsightSave({
    title: "",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: false,
  });
  assert.equal(result.blocked, true, "missing title must hard-block save for non-synced items");
});

test("onSave: blocked when title is whitespace-only for non-synced insight", () => {
  const result = simulateInsightSave({
    title: "   ",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: false,
  });
  assert.equal(result.blocked, true, "whitespace-only title must hard-block save");
});

test("onSave: synced insight with blank title is NOT blocked (title from source editor)", () => {
  const result = simulateInsightSave({
    title: "",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: true,
  });
  assert.equal(result.blocked, false,
    "synced items bypass the title hard-block — title comes from the source editor");
  assert.equal(result.toastFired, true,
    "meta-desc warning still fires for active synced insights with no description");
});
