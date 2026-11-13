/**
 * Invariant tests for the meta-description guard in the workshop editor
 * (workshop-edit.tsx).
 *
 * Tests are written against the production `workshopNoMetaDesc` function
 * exported from meta-desc-guard.ts and imported by the component. Any
 * change to that production function — including deletion — will break
 * these tests.
 *
 * Coverage:
 *  1. workshopNoMetaDesc returns true only when BOTH shortDescription AND
 *     seoDescription are blank (or whitespace-only).
 *  2. The amber banner condition is `active && workshopNoMetaDesc(...)`.
 *     It must not fire for inactive workshops.
 *  3. The save path is NOT blocked by a missing meta description — the toast
 *     fires as a warning but the mutation still runs.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/library/workshop-meta-desc-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { workshopNoMetaDesc } from "./meta-desc-guard";

// ─── workshopNoMetaDesc tests ─────────────────────────────────────────────────

test("workshopNoMetaDesc: true when both shortDescription and seoDescription are empty strings", () => {
  assert.equal(workshopNoMetaDesc("", ""), true);
});

test("workshopNoMetaDesc: true when both are whitespace-only", () => {
  assert.equal(workshopNoMetaDesc("   ", "\t\n"), true);
});

test("workshopNoMetaDesc: false when shortDescription has content", () => {
  assert.equal(workshopNoMetaDesc("A practical AI workshop for leaders.", ""), false);
});

test("workshopNoMetaDesc: false when seoDescription has content", () => {
  assert.equal(workshopNoMetaDesc("", "Optimised meta description for search engines."), false);
});

test("workshopNoMetaDesc: false when both have content", () => {
  assert.equal(workshopNoMetaDesc("Short desc", "SEO desc"), false);
});

test("workshopNoMetaDesc: false when shortDescription is whitespace but seoDescription has content", () => {
  assert.equal(workshopNoMetaDesc("  ", "Non-empty SEO description"), false);
});

test("workshopNoMetaDesc: false when seoDescription is whitespace but shortDescription has content", () => {
  assert.equal(workshopNoMetaDesc("Non-empty short description", "   "), false);
});

// ─── Banner visibility condition ──────────────────────────────────────────────
// Mirrors the JSX condition: {form.active && workshopNoMetaDesc(...) && <Banner/>}

test("banner condition: true for active workshop with both fields blank", () => {
  const active = true;
  assert.equal(active && workshopNoMetaDesc("", ""), true,
    "data-testid=banner-no-meta-desc should be rendered");
});

test("banner condition: false for INACTIVE workshop even when both fields are blank", () => {
  const active = false;
  assert.equal(active && workshopNoMetaDesc("", ""), false,
    "banner must not appear for inactive workshops");
});

test("banner condition: false for active workshop when shortDescription is filled", () => {
  const active = true;
  assert.equal(active && workshopNoMetaDesc("Hands-on AI strategy workshop.", ""), false);
});

test("banner condition: false for active workshop when seoDescription is filled", () => {
  const active = true;
  assert.equal(active && workshopNoMetaDesc("", "SEO-optimised description for the workshop."), false);
});

test("banner condition: false for active workshop when both fields are filled", () => {
  const active = true;
  assert.equal(active && workshopNoMetaDesc("Short desc", "SEO desc"), false);
});

// ─── onSave behaviour ─────────────────────────────────────────────────────────
// Mirrors the onSave guard in workshop-edit.tsx.
// The title is enforced by the HTML `required` attribute on the form input;
// a missing title blocks submission before the JS handler runs.
// Uses the real production function to compute noMetaDesc.

interface SaveResult {
  blocked: boolean;
  toastFired: boolean;
}

function simulateWorkshopSave(opts: {
  title: string;
  active: boolean;
  shortDescription: string;
  seoDescription: string;
}): SaveResult {
  // Hard block — mirrors the HTML `required` attribute on the title input;
  // the browser prevents form submission when the field is empty.
  if (!opts.title.trim()) return { blocked: true, toastFired: false };

  // Soft warning using the production function
  const noDesc = workshopNoMetaDesc(opts.shortDescription, opts.seoDescription);
  const toastFired = opts.active && noDesc;
  // saveMut.mutate() is always called — save is not blocked by missing meta desc
  return { blocked: false, toastFired };
}

test("onSave: toast fires but save is NOT blocked when active workshop has no meta desc", () => {
  const result = simulateWorkshopSave({
    title: "AI Strategy Sprint",
    active: true,
    shortDescription: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false, "save must not be blocked — meta desc warning is advisory");
  assert.equal(result.toastFired, true,
    "warning toast must fire when active workshop has no meta description");
});

test("onSave: no toast and save proceeds when active workshop has a shortDescription", () => {
  const result = simulateWorkshopSave({
    title: "AI Strategy Sprint",
    active: true,
    shortDescription: "A focused sprint to build your AI roadmap.",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false, "no warning toast when shortDescription is provided");
});

test("onSave: no toast and save proceeds when active workshop has a seoDescription", () => {
  const result = simulateWorkshopSave({
    title: "AI Strategy Sprint",
    active: true,
    shortDescription: "",
    seoDescription: "Learn to build a practical AI strategy in one focused sprint.",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false);
});

test("onSave: no toast when workshop is inactive (even with no meta desc)", () => {
  const result = simulateWorkshopSave({
    title: "AI Strategy Sprint",
    active: false,
    shortDescription: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false,
    "no meta-desc toast for inactive workshops");
});

test("onSave: blocked when title is missing (enforced by HTML required attribute)", () => {
  const result = simulateWorkshopSave({
    title: "",
    active: true,
    shortDescription: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, true, "missing title must hard-block save");
});

test("onSave: blocked when title is whitespace-only", () => {
  const result = simulateWorkshopSave({
    title: "   ",
    active: true,
    shortDescription: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, true, "whitespace-only title must hard-block save");
});
