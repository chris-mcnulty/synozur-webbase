/**
 * Invariant tests for the SEO audit admin screen's pure-logic config.
 *
 * These pin three hard-safety rules that the TypeScript compiler alone can't
 * catch across the frontend/backend boundary:
 *
 *  1. Every SeoArtifactKind in SEO_ARTIFACT_KINDS has a non-empty KIND_LABEL.
 *  2. Every SeoArtifactKind returns a non-empty string from editorHref.
 *  3. og_image_missing is NOT in FILLABLE_KEYS — it is a pure warning, not
 *     something the autofill endpoint can write to any column.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/marketing/seo-audit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SEO_ARTIFACT_KINDS,
  KIND_LABEL,
  FILLABLE_KEYS,
  editorHref,
} from "./seo-audit-config";

test("KIND_LABEL: every kind has a non-empty label", () => {
  for (const kind of SEO_ARTIFACT_KINDS) {
    const label = KIND_LABEL[kind];
    assert.ok(
      typeof label === "string" && label.trim().length > 0,
      `KIND_LABEL["${kind}"] is missing or blank (got ${JSON.stringify(label)})`,
    );
  }
});

test("editorHref: every kind returns a non-empty string", () => {
  const id = "test-id-123";
  for (const kind of SEO_ARTIFACT_KINDS) {
    const href = editorHref(kind, id);
    assert.ok(
      typeof href === "string" && href.trim().length > 0,
      `editorHref("${kind}", "${id}") returned empty or non-string (got ${JSON.stringify(href)})`,
    );
  }
});

test("editorHref: id-bearing kinds include the id in the returned path", () => {
  const id = "abc-123";
  const idKinds = [
    "insight",
    "service",
    "solution",
    "model",
    "workshop",
    "polaris",
    "event",
    "collateral",
  ] as const;
  for (const kind of idKinds) {
    const href = editorHref(kind, id);
    assert.ok(
      href.includes(id),
      `editorHref("${kind}", "${id}") should include the id but got "${href}"`,
    );
  }
});

test("FILLABLE_KEYS: og_image_missing is absent (pure warning, not patchable)", () => {
  assert.ok(
    !FILLABLE_KEYS.has("og_image_missing"),
    'FILLABLE_KEYS must not contain "og_image_missing" — it is a display-only warning',
  );
});

test("FILLABLE_KEYS: seoTitleLong is absent (wand button autofills via seoTitle key)", () => {
  assert.ok(
    !FILLABLE_KEYS.has("seoTitleLong"),
    'FILLABLE_KEYS must not contain "seoTitleLong" — the suggested fix is written via the "seoTitle" key',
  );
});

test("FILLABLE_KEYS: core autofillable keys are present", () => {
  const expected = ["seoTitle", "seoDescription", "seoDescriptionShort", "seoDescriptionLong", "ogImage"];
  for (const key of expected) {
    assert.ok(
      FILLABLE_KEYS.has(key),
      `FILLABLE_KEYS is missing expected autofillable key "${key}"`,
    );
  }
});

test("SEO_ARTIFACT_KINDS: no duplicate entries", () => {
  const seen = new Set<string>();
  for (const kind of SEO_ARTIFACT_KINDS) {
    assert.ok(!seen.has(kind), `Duplicate kind in SEO_ARTIFACT_KINDS: "${kind}"`);
    seen.add(kind);
  }
});

test("SEO_ARTIFACT_KINDS: list is non-empty", () => {
  assert.ok(SEO_ARTIFACT_KINDS.length > 0, "SEO_ARTIFACT_KINDS must not be empty");
});
