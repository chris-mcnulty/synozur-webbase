/**
 * Invariant tests for the meta-description guard in the Polaris episode
 * editor (polaris-episode-edit.tsx).
 *
 * Tests are written against the production `polarisEpisodeNoMetaDesc`
 * function exported from meta-desc-guard.ts and imported by the component.
 * Any change to that production function — including deletion — will break
 * these tests.
 *
 * Coverage:
 *  1. polarisEpisodeNoMetaDesc returns true only when BOTH summary AND
 *     seoDescription are blank (or whitespace-only).
 *  2. The amber banner condition is `active && polarisEpisodeNoMetaDesc(...)`.
 *     It must not fire for inactive episodes.
 *  3. The save path is NOT blocked by a missing meta description — the toast
 *     fires as a warning but the mutation still runs.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/library/polaris-episode-meta-desc-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { polarisEpisodeNoMetaDesc } from "./meta-desc-guard";

// ─── polarisEpisodeNoMetaDesc tests ──────────────────────────────────────────

test("polarisEpisodeNoMetaDesc: true when both summary and seoDescription are empty strings", () => {
  assert.equal(polarisEpisodeNoMetaDesc("", ""), true);
});

test("polarisEpisodeNoMetaDesc: true when both are whitespace-only", () => {
  assert.equal(polarisEpisodeNoMetaDesc("   ", "\t\n"), true);
});

test("polarisEpisodeNoMetaDesc: false when seoDescription has content", () => {
  assert.equal(polarisEpisodeNoMetaDesc("A great episode about AI.", ""), false);
});

test("polarisEpisodeNoMetaDesc: false when summary has content", () => {
  assert.equal(polarisEpisodeNoMetaDesc("", "Summary text here."), false);
});

test("polarisEpisodeNoMetaDesc: false when both have content", () => {
  assert.equal(polarisEpisodeNoMetaDesc("SEO desc", "Summary"), false);
});

test("polarisEpisodeNoMetaDesc: false when seoDescription is whitespace but summary has content", () => {
  assert.equal(polarisEpisodeNoMetaDesc("  ", "Non-empty summary"), false);
});

test("polarisEpisodeNoMetaDesc: false when summary is whitespace but seoDescription has content", () => {
  assert.equal(polarisEpisodeNoMetaDesc("Non-empty seo", "   "), false);
});

// ─── Banner visibility condition ──────────────────────────────────────────────
// Mirrors the JSX condition: {form.active && polarisEpisodeNoMetaDesc(...) && <Banner/>}

test("banner condition: true for active episode with both fields blank", () => {
  const active = true;
  assert.equal(active && polarisEpisodeNoMetaDesc("", ""), true,
    "data-testid=banner-no-meta-desc should be rendered");
});

test("banner condition: false for INACTIVE episode even when both fields are blank", () => {
  const active = false;
  assert.equal(active && polarisEpisodeNoMetaDesc("", ""), false,
    "banner must not appear for inactive episodes");
});

test("banner condition: false for active episode when summary is filled", () => {
  const active = true;
  assert.equal(active && polarisEpisodeNoMetaDesc("", "Episode summary."), false);
});

test("banner condition: false for active episode when seoDescription is filled", () => {
  const active = true;
  assert.equal(active && polarisEpisodeNoMetaDesc("SEO-optimised desc.", ""), false);
});

test("banner condition: false for active episode when both fields are filled", () => {
  const active = true;
  assert.equal(active && polarisEpisodeNoMetaDesc("SEO desc", "Summary"), false);
});

// ─── onSave behaviour ─────────────────────────────────────────────────────────
// Mirrors the onSave guard in polaris-episode-edit.tsx.
// Uses the real production function to compute noMetaDesc.

interface SaveResult {
  blocked: boolean;
  toastFired: boolean;
}

function simulatePolarisSave(opts: {
  title: string;
  episodeNumber: string;
  active: boolean;
  seoDescription: string;
  summary: string;
}): SaveResult {
  // Hard blocks — same checks as onSave in the component
  if (!opts.title.trim()) return { blocked: true, toastFired: false };
  if (opts.episodeNumber === "" || Number.isNaN(Number(opts.episodeNumber))) {
    return { blocked: true, toastFired: false };
  }
  // Soft warning using the production function
  const noDesc = polarisEpisodeNoMetaDesc(opts.seoDescription, opts.summary);
  const toastFired = opts.active && noDesc;
  // Mutation always called — save is not blocked
  return { blocked: false, toastFired };
}

test("onSave: toast fires but save is NOT blocked when active episode has no meta desc", () => {
  const result = simulatePolarisSave({
    title: "Episode 42",
    episodeNumber: "42",
    active: true,
    seoDescription: "",
    summary: "",
  });
  assert.equal(result.blocked, false, "save must not be blocked — meta desc warning is advisory");
  assert.equal(result.toastFired, true,
    "warning toast must fire when active episode has no meta description");
});

test("onSave: no toast and save proceeds when active episode has a summary", () => {
  const result = simulatePolarisSave({
    title: "Episode 43",
    episodeNumber: "43",
    active: true,
    seoDescription: "",
    summary: "Great guest, great insights.",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false, "no warning toast when summary is provided");
});

test("onSave: no toast and save proceeds when active episode has an seoDescription", () => {
  const result = simulatePolarisSave({
    title: "Episode 44",
    episodeNumber: "44",
    active: true,
    seoDescription: "Optimised meta.",
    summary: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false);
});

test("onSave: no toast when episode is inactive (even with no meta desc)", () => {
  const result = simulatePolarisSave({
    title: "Episode 45",
    episodeNumber: "45",
    active: false,
    seoDescription: "",
    summary: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false,
    "no meta-desc toast for inactive episodes");
});

test("onSave: blocked when title is missing (unrelated to meta desc)", () => {
  const result = simulatePolarisSave({
    title: "",
    episodeNumber: "1",
    active: true,
    seoDescription: "",
    summary: "",
  });
  assert.equal(result.blocked, true, "missing title must hard-block save");
});

test("onSave: blocked when episodeNumber is blank (unrelated to meta desc)", () => {
  const result = simulatePolarisSave({
    title: "Episode 46",
    episodeNumber: "",
    active: true,
    seoDescription: "",
    summary: "",
  });
  assert.equal(result.blocked, true, "missing episode number must hard-block save");
});

test("onSave: blocked when episodeNumber is not numeric (unrelated to meta desc)", () => {
  const result = simulatePolarisSave({
    title: "Episode 47",
    episodeNumber: "abc",
    active: true,
    seoDescription: "",
    summary: "",
  });
  assert.equal(result.blocked, true, "non-numeric episode number must hard-block save");
});
