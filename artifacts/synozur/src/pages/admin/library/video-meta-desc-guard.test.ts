/**
 * Invariant tests for the meta-description guard in the video/webinar
 * editor (video-edit.tsx).
 *
 * Tests are written against the production `videoNoMetaDesc` function
 * exported from meta-desc-guard.ts and imported by the component.  Any
 * change to that production function — including deletion — will break these
 * tests.
 *
 * Coverage:
 *  1. videoNoMetaDesc returns true only when BOTH shortDescription AND
 *     seoDescription are blank (or whitespace-only).
 *  2. The amber banner condition is `active && videoNoMetaDesc(...)`.
 *     It must not fire for inactive videos.
 *  3. The save path is NOT blocked by a missing meta description — the toast
 *     fires as a warning but the mutation still runs.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/library/video-meta-desc-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { videoNoMetaDesc } from "./meta-desc-guard";

// ─── videoNoMetaDesc tests ────────────────────────────────────────────────────

test("videoNoMetaDesc: true when both shortDescription and seoDescription are empty strings", () => {
  assert.equal(videoNoMetaDesc("", ""), true);
});

test("videoNoMetaDesc: true when both are whitespace-only", () => {
  assert.equal(videoNoMetaDesc("   ", "\t\n"), true);
});

test("videoNoMetaDesc: false when seoDescription has content", () => {
  assert.equal(videoNoMetaDesc("A great webinar about AI governance.", ""), false);
});

test("videoNoMetaDesc: false when shortDescription has content", () => {
  assert.equal(videoNoMetaDesc("", "One-sentence summary shown on list pages."), false);
});

test("videoNoMetaDesc: false when both have content", () => {
  assert.equal(videoNoMetaDesc("SEO desc", "Short desc"), false);
});

test("videoNoMetaDesc: false when seoDescription is whitespace but shortDescription has content", () => {
  assert.equal(videoNoMetaDesc("  ", "Non-empty short description"), false);
});

test("videoNoMetaDesc: false when shortDescription is whitespace but seoDescription has content", () => {
  assert.equal(videoNoMetaDesc("Non-empty seo", "   "), false);
});

// ─── Banner visibility condition ──────────────────────────────────────────────
// Mirrors the JSX condition: {form.active && videoNoMetaDesc(...) && <Banner/>}

test("banner condition: true for active video with both fields blank", () => {
  const active = true;
  assert.equal(active && videoNoMetaDesc("", ""), true,
    "data-testid=banner-no-meta-desc should be rendered");
});

test("banner condition: false for INACTIVE video even when both fields are blank", () => {
  const active = false;
  assert.equal(active && videoNoMetaDesc("", ""), false,
    "banner must not appear for inactive videos");
});

test("banner condition: false for active video when shortDescription is filled", () => {
  const active = true;
  assert.equal(active && videoNoMetaDesc("", "One-sentence summary for the card."), false);
});

test("banner condition: false for active video when seoDescription is filled", () => {
  const active = true;
  assert.equal(active && videoNoMetaDesc("SEO-optimised description.", ""), false);
});

test("banner condition: false for active video when both fields are filled", () => {
  const active = true;
  assert.equal(active && videoNoMetaDesc("SEO desc", "Short desc"), false);
});

// ─── onSave behaviour ─────────────────────────────────────────────────────────
// Mirrors the onSave guard in video-edit.tsx.
// Uses the real production function to compute noMetaDesc.

interface SaveResult {
  blocked: boolean;
  toastFired: boolean;
}

function simulateVideoSave(opts: {
  title: string;
  active: boolean;
  seoDescription: string;
  shortDescription: string;
}): SaveResult {
  // Hard block — same check as onSave in the component
  if (!opts.title.trim()) return { blocked: true, toastFired: false };

  // Soft warning using the production function
  const noDesc = videoNoMetaDesc(opts.seoDescription, opts.shortDescription);
  const toastFired = opts.active && noDesc;
  // Mutation always called — save is not blocked
  return { blocked: false, toastFired };
}

test("onSave: toast fires but save is NOT blocked when active video has no meta desc", () => {
  const result = simulateVideoSave({
    title: "AI Governance Webinar",
    active: true,
    seoDescription: "",
    shortDescription: "",
  });
  assert.equal(result.blocked, false, "save must not be blocked — meta desc warning is advisory");
  assert.equal(result.toastFired, true,
    "warning toast must fire when active video has no meta description");
});

test("onSave: no toast and save proceeds when active video has a shortDescription", () => {
  const result = simulateVideoSave({
    title: "AI Governance Webinar",
    active: true,
    seoDescription: "",
    shortDescription: "Join our expert panel on AI governance.",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false, "no warning toast when shortDescription is provided");
});

test("onSave: no toast and save proceeds when active video has an seoDescription", () => {
  const result = simulateVideoSave({
    title: "AI Governance Webinar",
    active: true,
    seoDescription: "Discover best practices for AI governance.",
    shortDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false);
});

test("onSave: no toast when video is inactive (even with no meta desc)", () => {
  const result = simulateVideoSave({
    title: "AI Governance Webinar",
    active: false,
    seoDescription: "",
    shortDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false,
    "no meta-desc toast for inactive videos");
});

test("onSave: blocked when title is missing (unrelated to meta desc)", () => {
  const result = simulateVideoSave({
    title: "",
    active: true,
    seoDescription: "",
    shortDescription: "",
  });
  assert.equal(result.blocked, true, "missing title must hard-block save");
});

test("onSave: blocked when title is whitespace-only (unrelated to meta desc)", () => {
  const result = simulateVideoSave({
    title: "   ",
    active: true,
    seoDescription: "",
    shortDescription: "",
  });
  assert.equal(result.blocked, true, "whitespace-only title must hard-block save");
});
