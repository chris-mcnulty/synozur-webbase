/**
 * Invariant tests for the meta-description guard as it applies to event
 * items edited via the collateral editor (collateral-edit.tsx).
 *
 * Tests are written against the production `eventNoMetaDesc` function
 * exported from meta-desc-guard.ts. Any change to that production function —
 * including deletion — will break these tests.
 *
 * Coverage:
 *  1. eventNoMetaDesc returns true only when BOTH description AND
 *     seoDescription are blank (or whitespace-only).
 *  2. The amber banner condition is `active && eventNoMetaDesc(...)`.
 *     It must not fire for inactive events.
 *  3. The save path is NOT blocked by a missing meta description — the toast
 *     fires as a warning but the mutation still runs.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/library/event-meta-desc-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { eventNoMetaDesc } from "./meta-desc-guard";

// ─── eventNoMetaDesc tests ────────────────────────────────────────────────────

test("eventNoMetaDesc: true when both description and seoDescription are empty strings", () => {
  assert.equal(eventNoMetaDesc("", ""), true);
});

test("eventNoMetaDesc: true when both are whitespace-only", () => {
  assert.equal(eventNoMetaDesc("   ", "\t\n"), true);
});

test("eventNoMetaDesc: false when description has content", () => {
  assert.equal(eventNoMetaDesc("Join us for a full-day AI leadership summit.", ""), false);
});

test("eventNoMetaDesc: false when seoDescription has content", () => {
  assert.equal(eventNoMetaDesc("", "Optimised meta description for search engines."), false);
});

test("eventNoMetaDesc: false when both have content", () => {
  assert.equal(eventNoMetaDesc("Description text", "SEO desc"), false);
});

test("eventNoMetaDesc: false when description is whitespace but seoDescription has content", () => {
  assert.equal(eventNoMetaDesc("  ", "Non-empty SEO description"), false);
});

test("eventNoMetaDesc: false when seoDescription is whitespace but description has content", () => {
  assert.equal(eventNoMetaDesc("Non-empty description", "   "), false);
});

// ─── Banner visibility condition ──────────────────────────────────────────────
// Mirrors the JSX condition in collateral-edit.tsx:
//   {form.active && noMetaDesc && <Banner/>}
// where noMetaDesc = collateralNoMetaDesc(...) (same logic as eventNoMetaDesc)

test("banner condition: true for active event with both fields blank", () => {
  const active = true;
  assert.equal(active && eventNoMetaDesc("", ""), true,
    "data-testid=banner-no-meta-desc should be rendered");
});

test("banner condition: false for INACTIVE event even when both fields are blank", () => {
  const active = false;
  assert.equal(active && eventNoMetaDesc("", ""), false,
    "banner must not appear for inactive events");
});

test("banner condition: false for active event when description is filled", () => {
  const active = true;
  assert.equal(active && eventNoMetaDesc("A hands-on summit for AI practitioners.", ""), false);
});

test("banner condition: false for active event when seoDescription is filled", () => {
  const active = true;
  assert.equal(active && eventNoMetaDesc("", "SEO-optimised description for the event."), false);
});

test("banner condition: false for active event when both fields are filled", () => {
  const active = true;
  assert.equal(active && eventNoMetaDesc("Short desc", "SEO desc"), false);
});

// ─── onSave behaviour ─────────────────────────────────────────────────────────
// Mirrors the onSave guard in collateral-edit.tsx for event-type items.
// A missing title is a hard block for non-synced items.
// Uses the real production function to compute noMetaDesc.

interface SaveResult {
  blocked: boolean;
  toastFired: boolean;
}

function simulateEventSave(opts: {
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
  const noDesc = eventNoMetaDesc(opts.description, opts.seoDescription);
  const toastFired = opts.active && noDesc;
  // saveMut.mutate() is always called — save is not blocked by missing meta desc
  return { blocked: false, toastFired };
}

test("onSave: toast fires but save is NOT blocked when active event has no meta desc", () => {
  const result = simulateEventSave({
    title: "Synozur AI Leadership Summit 2026",
    active: true,
    description: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false, "save must not be blocked — meta desc warning is advisory");
  assert.equal(result.toastFired, true,
    "warning toast must fire when active event has no meta description");
});

test("onSave: no toast and save proceeds when active event has a description", () => {
  const result = simulateEventSave({
    title: "Synozur AI Leadership Summit 2026",
    active: true,
    description: "A full-day gathering of AI leaders and practitioners from across the region.",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false, "no warning toast when description is provided");
});

test("onSave: no toast and save proceeds when active event has a seoDescription", () => {
  const result = simulateEventSave({
    title: "Synozur AI Leadership Summit 2026",
    active: true,
    description: "",
    seoDescription: "Register for the Synozur AI Leadership Summit — one day of deep-dive sessions.",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false);
});

test("onSave: no toast when event is inactive (even with no meta desc)", () => {
  const result = simulateEventSave({
    title: "Synozur AI Leadership Summit 2026",
    active: false,
    description: "",
    seoDescription: "",
  });
  assert.equal(result.blocked, false);
  assert.equal(result.toastFired, false,
    "no meta-desc toast for inactive events");
});

test("onSave: blocked when title is missing for non-synced event", () => {
  const result = simulateEventSave({
    title: "",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: false,
  });
  assert.equal(result.blocked, true, "missing title must hard-block save for non-synced items");
});

test("onSave: blocked when title is whitespace-only for non-synced event", () => {
  const result = simulateEventSave({
    title: "   ",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: false,
  });
  assert.equal(result.blocked, true, "whitespace-only title must hard-block save");
});

test("onSave: synced event with blank title is NOT blocked (title from source editor)", () => {
  const result = simulateEventSave({
    title: "",
    active: true,
    description: "",
    seoDescription: "",
    isSynced: true,
  });
  assert.equal(result.blocked, false,
    "synced items bypass the title hard-block — title comes from the source editor");
  assert.equal(result.toastFired, true,
    "meta-desc warning still fires for active synced events with no description");
});
