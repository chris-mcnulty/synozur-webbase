/**
 * Invariant tests for the meta-description guard in the collateral/library
 * item editor (collateral-edit.tsx).
 *
 * Tests are written against the production `collateralNoMetaDesc` function
 * exported from meta-desc-guard.ts and imported by the component. Any
 * change to that production function — including deletion — will break
 * these tests.
 *
 * Coverage:
 *  1. collateralNoMetaDesc returns true only when BOTH description AND
 *     seoDescription are blank (or whitespace-only).
 *  2. The amber banner condition is `active && collateralNoMetaDesc(...)`.
 *     It must not fire for inactive items.
 *  3. The save path is NOT blocked by a missing meta description — the toast
 *     fires as a warning but the mutation still runs.
 *  4. A missing title IS a hard block (for non-synced items).
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/library/collateral-meta-desc-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { collateralNoMetaDesc } from "./meta-desc-guard";

// ─── collateralNoMetaDesc tests ───────────────────────────────────────────────

test("collateralNoMetaDesc: true when both description and seoDescription are empty strings", () => {
  assert.equal(collateralNoMetaDesc("", ""), true);
});

test("collateralNoMetaDesc: true when both are whitespace-only", () => {
  assert.equal(collateralNoMetaDesc("   ", "\t\n"), true);
});

test("collateralNoMetaDesc: false when description has content", () => {
  assert.equal(collateralNoMetaDesc("An in-depth white paper on AI governance.", ""), false);
});

test("collateralNoMetaDesc: false when seoDescription has content", () => {
  assert.equal(collateralNoMetaDesc("", "Optimised meta description for search engines."), false);
});

test("collateralNoMetaDesc: false when both have content", () => {
  assert.equal(collateralNoMetaDesc("Description text", "SEO desc"), false);
});

test("collateralNoMetaDesc: false when description is whitespace but seoDescription has content", () => {
  assert.equal(collateralNoMetaDesc("  ", "Non-empty SEO description"), false);
});

test("collateralNoMetaDesc: false when seoDescription is whitespace but description has content", () => {
  assert.equal(collateralNoMetaDesc("Non-empty description", "   "), false);
});

// ─── Banner visibility condition ──────────────────────────────────────────────
// Mirrors the JSX condition: {form.active && collateralNoMetaDesc(...) && <Banner/>}

test("banner condition: true for active item with both fields blank", () => {
  const active = true;
  assert.equal(active && collateralNoMetaDesc("", ""), true,
    "data-testid=banner-no-meta-desc should be rendered");
});

test("banner condition: false for INACTIVE item even when both fields are blank", () => {
  const active = false;
  assert.equal(active && collateralNoMetaDesc("", ""), false,
    "banner must not appear for inactive collateral items");
});

test("banner condition: false for active item when description is filled", () => {
  const active = true;
  assert.equal(active && collateralNoMetaDesc("A detailed guide for practitioners.", ""), false);
});

test("banner condition: false for active item when seoDescription is filled", () => {
  const active = true;
  assert.equal(active && collateralNoMetaDesc("", "SEO-optimised description for the white paper."), false);
});

test("banner condition: false for active item when both fields are filled", () => {
  const active = true;
  assert.equal(active && collateralNoMetaDesc("Description", "SEO desc"), false);
});

// ─── onSave behaviour ─────────────────────────────────────────────────────────
// Mirrors the onSave guard in collateral-edit.tsx.
// For non-synced items, a blank title returns early (hard block).
// Uses the real production function to compute noMetaDesc.

interface SaveResult {
  blocked: boolean;
  toastFired: boolean;
}

function simulateCollateralSave(opts: {
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
  const noDesc = collateralNoMetaDesc(opts.description, opts.seoDescription);
  const toastFired = opts.active && noDesc;
  // Mutation always called — save is not blocked by missing meta desc
  return { blocked: false, toastFired };
}

test("onSave: toast fires but save is NOT blocked when active item has no meta desc", () => {
  const result = simulateCollateralSave({
    title: "AI Governance White Paper",
    active: true,
    description: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false, "save must not be blocked — meta desc warning is advisory");
  assert.equal(result.toastFired, true,
    "warning toast must fire when active item has no meta description");
});

test("onSave: no toast and save proceeds when active item has a description", () => {
  const result = simulateCollateralSave({
    title: "AI Governance White Paper",
    active: true,
    description: "Comprehensive guidance on responsible AI governance frameworks.",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false, "no warning toast when description is provided");
});

test("onSave: no toast and save proceeds when active item has a seoDescription", () => {
  const result = simulateCollateralSave({
    title: "AI Governance White Paper",
    active: true,
    description: "",
    seoDescription: "Download our white paper on AI governance best practices.",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false);
});

test("onSave: no toast when item is inactive (even with no meta desc)", () => {
  const result = simulateCollateralSave({
    title: "AI Governance White Paper",
    active: false,
    description: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false,
    "no meta-desc toast for inactive collateral items");
});

test("onSave: blocked when title is missing for non-synced item", () => {
  const result = simulateCollateralSave({
    title: "",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: false,
  });
  assert.equal(result.blocked, true, "missing title must hard-block save for non-synced items");
});

test("onSave: blocked when title is whitespace-only for non-synced item", () => {
  const result = simulateCollateralSave({
    title: "   ",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: false,
  });
  assert.equal(result.blocked, true, "whitespace-only title must hard-block save");
});

test("onSave: synced item with blank title is NOT blocked (title not editable for synced rows)", () => {
  const result = simulateCollateralSave({
    title: "",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: true,
  });
  // Synced rows skip the title check; the meta-desc toast may still fire
  assert.equal(result.blocked, false,
    "synced items bypass the title hard-block — title comes from the source editor");
  assert.equal(result.toastFired, true,
    "meta-desc warning still fires for active synced items with no description");
});
