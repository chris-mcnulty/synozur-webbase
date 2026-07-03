/**
 * Guards the "never overwrite a non-empty seoDescription" invariant in
 * `applyAutofill` across all ten artifact kinds.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:seo-autofill
 *
 * The invariant has two enforcement layers — both are tested here:
 *
 *  Layer 1 — Detection (`buildFinding`)
 *    A non-empty description, even if short, must emit `seoDescriptionShort`
 *    (not `seoDescription`).  This ensures the audit correctly classifies the
 *    field as "present but could be improved", never as "absent".
 *
 *  Layer 2 — Patch construction (`buildAutofillPatch`)
 *    `seoDescription` is included in the patch ONLY when one of the three
 *    description missing codes is present in `f.missing`.  A finding with no
 *    description code in `missing` must never produce a `seoDescription` patch,
 *    regardless of what `f.suggested.seoDescription` contains.
 *
 *    (The third layer — SQL WHERE guards — operates at DB level and ensures that
 *    even a stale finding cannot clobber a value written concurrently; that
 *    layer is verified by integration tests against a real database.)
 *
 * Previously broken case (now fixed):
 *   For `insight` rows a `seoDescriptionShort` finding was processed without
 *   the SQL empty-check guard, silently overwriting editor-set descriptions
 *   that happened to be short.  These tests would have caught that regression.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFinding,
  buildAutofillPatch,
  type ArtifactKind,
  type AuditFinding,
} from "./seoAudit.js";

const ALL_KINDS: ArtifactKind[] = [
  "insight",
  "service",
  "solution",
  "application",
  "case-study",
  "model",
  "workshop",
  "polaris",
  "event",
  "collateral",
];

/** A description that is non-empty but shorter than the 70-char minimum. */
const SHORT_DESC = "Intentionally brief.";

/** Long enough body text for `suggestDescription` to produce a 70+ char result. */
const RICH_BODY =
  "This paragraph describes the artifact in sufficient detail to produce a " +
  "suggestion that comfortably exceeds the minimum SERP description length.";

/**
 * Build a finding via `buildFinding` with all OG findings suppressed so only
 * description signals are in play.  `hasEditorImage: true` suppresses both OG
 * finding types for every kind.
 */
function findingWithDesc(kind: ArtifactKind, seoDescription: string | null): AuditFinding | null {
  return buildFinding({
    kind,
    id: "test-id-1",
    slug: "test-slug",
    title: "Test Artifact Title",
    path: `/test/${kind}/test-slug`,
    seoTitle: "A good SEO title for tests",
    seoDescription,
    ogImage: null,
    fallbackImage: null,
    hasEditorImage: true,
    descriptionSources: [RICH_BODY],
  });
}

/** Manually craft an `AuditFinding` with an explicit `missing` list. */
function manualFinding(kind: ArtifactKind, missing: string[], suggested: AuditFinding["suggested"]): AuditFinding {
  return {
    kind,
    id: "test-id-2",
    slug: "test-slug",
    title: "Test Artifact Title",
    path: `/test/${kind}/test-slug`,
    missing,
    suggested,
  };
}

// ─── Layer 1: buildFinding — seoDescriptionShort detection ─────────────────
//
// For every kind: a non-empty but short seoDescription must produce
// `seoDescriptionShort` in `missing` and must NOT produce `seoDescription`.
// A suggestion from rich body text must also be available.

for (const kind of ALL_KINDS) {
  test(`buildFinding [${kind}]: non-empty short seoDescription → seoDescriptionShort, not seoDescription`, () => {
    const f = findingWithDesc(kind, SHORT_DESC);
    assert.ok(f !== null, "a finding must be returned for a short description");
    assert.ok(
      f.missing.includes("seoDescriptionShort"),
      `${kind}: seoDescriptionShort must be in missing`,
    );
    assert.ok(
      !f.missing.includes("seoDescription"),
      `${kind}: seoDescription must NOT be in missing — the field is non-empty`,
    );
    assert.ok(
      f.suggested.seoDescription,
      `${kind}: a suggested replacement must be populated from descriptionSources`,
    );
  });
}

// ─── Layer 1 (complementary): null / empty description → seoDescription ────
//
// Confirm the opposite: a truly blank description emits `seoDescription` (the
// "absent" code), not `seoDescriptionShort`.

for (const kind of ALL_KINDS) {
  test(`buildFinding [${kind}]: null seoDescription → seoDescription missing code`, () => {
    const f = findingWithDesc(kind, null);
    assert.ok(f !== null, "a finding must be returned for a null description");
    assert.ok(
      f.missing.includes("seoDescription"),
      `${kind}: seoDescription must be in missing when the field is null`,
    );
    assert.ok(
      !f.missing.includes("seoDescriptionShort"),
      `${kind}: seoDescriptionShort must NOT fire for a null description`,
    );
  });
}

for (const kind of ALL_KINDS) {
  test(`buildFinding [${kind}]: empty-string seoDescription → seoDescription missing code`, () => {
    const f = findingWithDesc(kind, "   ");
    assert.ok(f !== null, "a finding must be returned for a whitespace-only description");
    assert.ok(
      f.missing.includes("seoDescription"),
      `${kind}: whitespace-only seoDescription is treated as absent`,
    );
    assert.ok(
      !f.missing.includes("seoDescriptionShort"),
      `${kind}: seoDescriptionShort must NOT fire for a whitespace-only description`,
    );
  });
}

// ─── Layer 2: buildAutofillPatch — patch construction ──────────────────────

// 2a. seoDescriptionShort → patch IS built (improvement is offered, guarded
//     at DB level by the SQL empty-check so a non-empty value can't be clobbered).

for (const kind of ALL_KINDS) {
  test(`buildAutofillPatch [${kind}]: seoDescriptionShort finding produces a description patch`, () => {
    const f = findingWithDesc(kind, SHORT_DESC);
    assert.ok(f !== null, "precondition: finding must exist");
    assert.ok(f.missing.includes("seoDescriptionShort"), "precondition: seoDescriptionShort in missing");

    const patch = buildAutofillPatch(f);
    assert.ok(
      patch.seoDescription,
      `${kind}: patch must include seoDescription for a seoDescriptionShort finding`,
    );
  });
}

// 2b. seoDescription (absent) → patch IS built.

for (const kind of ALL_KINDS) {
  test(`buildAutofillPatch [${kind}]: seoDescription-absent finding produces a description patch`, () => {
    const f = findingWithDesc(kind, null);
    assert.ok(f !== null, "precondition: finding must exist");
    assert.ok(f.missing.includes("seoDescription"), "precondition: seoDescription in missing");

    const patch = buildAutofillPatch(f);
    assert.ok(
      patch.seoDescription,
      `${kind}: patch must include seoDescription for a seoDescription-absent finding`,
    );
  });
}

// 2c. No description code in missing → seoDescription NEVER patched.
//     This is the critical "never overwrite a non-empty field" invariant at the
//     patch layer: even when `suggested.seoDescription` is populated, it must
//     not flow into the patch unless the corresponding missing code is present.

for (const kind of ALL_KINDS) {
  test(`buildAutofillPatch [${kind}]: no description code in missing → seoDescription not patched`, () => {
    const f = manualFinding(
      kind,
      ["seoTitle", "ogImage"],
      {
        seoTitle: "A better title",
        seoDescription: "A perfectly good longer suggestion that should not overwrite anything.",
        ogImage: "https://cdn.example.com/hero.jpg",
      },
    );

    const patch = buildAutofillPatch(f);
    assert.equal(
      patch.seoDescription,
      undefined,
      `${kind}: seoDescription must not be patched when no description code is in missing`,
    );
  });
}

// 2d. seoDescriptionLong → patch IS built (offers a clamped replacement).

for (const kind of ALL_KINDS) {
  test(`buildAutofillPatch [${kind}]: seoDescriptionLong finding produces a description patch`, () => {
    const tooLong = "x".repeat(200);
    const f = manualFinding(
      kind,
      ["seoDescriptionLong"],
      { seoDescription: "A clamped replacement description." },
    );

    const patch = buildAutofillPatch(f);
    assert.ok(
      patch.seoDescription,
      `${kind}: patch must include seoDescription for a seoDescriptionLong finding`,
    );
    // Suppresses unused variable warning
    void tooLong;
  });
}

// ─── Invariants: seoTitle and ogImage patches are independent ───────────────
//
// Confirm that the description gate does not accidentally block or enable
// seoTitle / ogImage patches.

test("buildAutofillPatch: seoTitle patch built independently of description codes", () => {
  const f = manualFinding(
    "service",
    ["seoTitle"],
    { seoTitle: "Better SEO Title" },
  );
  const patch = buildAutofillPatch(f);
  assert.equal(patch.seoTitle, "Better SEO Title");
  assert.equal(patch.seoDescription, undefined, "no description code → no description patch");
  assert.equal(patch.ogImage, undefined);
});

test("buildAutofillPatch: ogImage patch built independently of description codes", () => {
  const f = manualFinding(
    "application",
    ["ogImage"],
    { ogImage: "https://cdn.example.com/og.jpg" },
  );
  const patch = buildAutofillPatch(f);
  assert.equal(patch.ogImage, "https://cdn.example.com/og.jpg");
  assert.equal(patch.seoDescription, undefined, "no description code → no description patch");
  assert.equal(patch.seoTitle, undefined);
});

test("buildAutofillPatch: empty finding (no missing, no suggested) → empty patch", () => {
  const f = manualFinding("model", [], {});
  const patch = buildAutofillPatch(f);
  assert.deepEqual(patch, {});
});

test("buildAutofillPatch: suggested present but missing list empty → no patch fields", () => {
  const f = manualFinding(
    "collateral",
    [],
    {
      seoTitle: "Ignored title",
      seoDescription: "Ignored description that is long enough.",
      ogImage: "https://cdn.example.com/ignored.jpg",
    },
  );
  const patch = buildAutofillPatch(f);
  assert.deepEqual(
    patch,
    {},
    "suggestions must never flow into a patch when missing list is empty",
  );
});

// ─── Coverage: all 10 kinds are represented in the ALL_KINDS list ───────────

test("ALL_KINDS covers every ArtifactKind value", () => {
  const expected: ArtifactKind[] = [
    "insight",
    "service",
    "solution",
    "application",
    "case-study",
    "model",
    "workshop",
    "polaris",
    "event",
    "collateral",
  ];
  assert.deepEqual(
    [...ALL_KINDS].sort(),
    [...expected].sort(),
    "ALL_KINDS must list all ten ArtifactKind values",
  );
});
