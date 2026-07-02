/**
 * #360 — Lock in the two OG-image signals emitted by the SEO audit and the
 * per-kind suppression policy, so the branching can't silently regress as new
 * audited page types are added.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:seo-og-findings
 *
 * Two distinct signals from `buildFinding`:
 *   - `ogImage`          — dedicated og_image column blank but a hero/artwork
 *                          image exists to promote in. Autofillable.
 *   - `og_image_missing` — page has NO editor share image at all → dynamic OG
 *                          card fallback. Pure warning, never autofilled.
 *
 * `filterOgFindings`/`OG_FINDING_POLICY` decide, per kind, whether each signal
 * survives into the report.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFinding,
  filterOgFindings,
  OG_FINDING_POLICY,
  type ArtifactKind,
} from "./seoAudit";

const ALL_KINDS: ArtifactKind[] = [
  "insight",
  "service",
  "solution",
  "application",
  "case-study",
  "model",
  "workshop",
  "polaris",
];

// A finding with valid SEO title/description so only the OG signals are in play.
function ogOnlyFinding(args: {
  kind: ArtifactKind;
  ogImage: string | null;
  fallbackImage: string | null;
  hasEditorImage?: boolean;
}) {
  return buildFinding({
    kind: args.kind,
    id: "id-1",
    slug: "slug-1",
    title: "A perfectly reasonable title",
    path: "/x/slug-1",
    seoTitle: "A perfectly reasonable SEO title",
    seoDescription:
      "A sufficiently long and descriptive meta description that sits comfortably inside the SERP window.",
    ogImage: args.ogImage,
    fallbackImage: args.fallbackImage,
    hasEditorImage: args.hasEditorImage,
    descriptionSources: ["body"],
  });
}

// ─── buildFinding: the two raw OG signals ─────────────────────────────────────

test("buildFinding: og_image column blank but fallback exists → autofillable ogImage, no warning", () => {
  const f = ogOnlyFinding({
    kind: "application",
    ogImage: null,
    fallbackImage: "https://cdn/hero.jpg",
  });
  assert.ok(f);
  assert.ok(f.missing.includes("ogImage"), "should emit autofillable ogImage");
  assert.equal(f.suggested.ogImage, "https://cdn/hero.jpg");
  assert.ok(
    !f.missing.includes("og_image_missing"),
    "a fallback image counts as an editor image, so no warning",
  );
});

test("buildFinding: no image of any kind → og_image_missing warning, not autofillable", () => {
  const f = ogOnlyFinding({
    kind: "application",
    ogImage: null,
    fallbackImage: null,
  });
  assert.ok(f);
  assert.ok(
    f.missing.includes("og_image_missing"),
    "should warn that there's no share image",
  );
  assert.ok(
    !f.missing.includes("ogImage"),
    "nothing to promote → no autofillable ogImage",
  );
  assert.equal(
    f.suggested.ogImage,
    undefined,
    "og_image_missing must never carry a suggestion",
  );
});

test("buildFinding: og_image already set → neither OG signal", () => {
  const f = ogOnlyFinding({
    kind: "application",
    ogImage: "https://cdn/share.jpg",
    fallbackImage: "https://cdn/hero.jpg",
  });
  assert.equal(f, null, "nothing missing at all → no finding");
});

test("buildFinding: hasEditorImage=true suppresses warning even with blank urls (id-backed image)", () => {
  const f = ogOnlyFinding({
    kind: "insight",
    ogImage: null,
    fallbackImage: null,
    hasEditorImage: true,
  });
  assert.equal(f, null, "explicit editor image → no OG finding at all");
});

test("buildFinding: hasEditorImage=false with blank urls → og_image_missing", () => {
  const f = ogOnlyFinding({
    kind: "insight",
    ogImage: null,
    fallbackImage: null,
    hasEditorImage: false,
  });
  assert.ok(f);
  assert.ok(f.missing.includes("og_image_missing"));
});

// ─── filterOgFindings: per-kind suppression policy ────────────────────────────

test("services never emit og_image_missing (no fixable image field)", () => {
  const out = filterOgFindings("service", ["seoDescription", "og_image_missing", "ogImage"]);
  assert.ok(!out.includes("og_image_missing"));
  assert.ok(!out.includes("ogImage"), "services also drop the unpersistable autofill");
  assert.deepEqual(out, ["seoDescription"]);
});

test("solutions never emit og_image_missing (no fixable image field)", () => {
  const out = filterOgFindings("solution", ["seoDescription", "og_image_missing", "ogImage"]);
  assert.ok(!out.includes("og_image_missing"));
  assert.ok(!out.includes("ogImage"));
  assert.deepEqual(out, ["seoDescription"]);
});

test("insights keep og_image_missing but drop the unpersistable ogImage autofill", () => {
  const out = filterOgFindings("insight", ["og_image_missing", "ogImage"]);
  assert.ok(out.includes("og_image_missing"), "insights are shared often — keep the warning");
  assert.ok(!out.includes("ogImage"), "posts have no og_image URL column to write");
});

test("workshops keep og_image_missing but drop the unpersistable ogImage autofill", () => {
  const out = filterOgFindings("workshop", ["og_image_missing", "ogImage"]);
  assert.ok(out.includes("og_image_missing"), "heroImage is fixable — keep the warning");
  assert.ok(!out.includes("ogImage"));
});

test("polaris keeps both og_image_missing and the autofillable ogImage", () => {
  const out = filterOgFindings("polaris", ["og_image_missing", "ogImage"]);
  assert.deepEqual(out, ["og_image_missing", "ogImage"]);
});

test("filterOgFindings preserves non-OG findings for every kind", () => {
  for (const kind of ALL_KINDS) {
    const out = filterOgFindings(kind, ["seoTitle", "seoDescription"]);
    assert.deepEqual(
      out,
      ["seoTitle", "seoDescription"],
      `${kind} must not touch non-OG findings`,
    );
  }
});

// ─── Invariants that guard against silent regression ──────────────────────────

test("every ArtifactKind has an OG_FINDING_POLICY entry", () => {
  for (const kind of ALL_KINDS) {
    assert.ok(OG_FINDING_POLICY[kind], `missing policy for ${kind}`);
  }
});

test("og_image_missing is only suppressed for kinds with no fixable image field", () => {
  const suppressed = ALL_KINDS.filter(
    (k) => OG_FINDING_POLICY[k].suppressOgImageMissing,
  ).sort();
  assert.deepEqual(
    suppressed,
    ["service", "solution"],
    "only services and solutions have no editor image field",
  );
});
