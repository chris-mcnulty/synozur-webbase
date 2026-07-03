/**
 * `applyAutofill` regression suite — verifies the "never overwrite a non-empty
 * seoDescription" invariant at the DB call level for all 10 artifact kinds.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:seo-autofill-apply
 *
 * ## How the invariant is enforced in production
 *
 * For flat-column kinds (insight, service, solution, application, case-study,
 * model, polaris, event, collateral) the WHERE clause of every seoDescription
 * UPDATE includes:
 *
 *   `(column IS NULL OR TRIM(column) = '')`
 *
 * This SQL guard is evaluated by the database engine — it only lets the UPDATE
 * affect rows whose seoDescription column is genuinely empty, regardless of
 * what the application layer sends.
 *
 * For workshop (JSONB seo column) the protection is JS-level: the function
 * reads the current `seo.description` value and skips the UPDATE entirely when
 * the value is non-blank.
 *
 * ## What these tests catch
 *
 * Each test injects a capturing mock in place of the real `db` so we can
 * inspect the arguments sent to every `.update()/.where()/.returning()` call
 * without a live database.  Two complementary assertions:
 *
 *   1. `db.update()` is called with the seoDescription patch (the autofill IS
 *      attempted, as intended) — any change that silently dropped the autofill
 *      attempt entirely would break this.
 *
 *   2. The WHERE argument contains the empty-check guard text (`is null` /
 *      `trim(`) — removing or misplacing the guard would break this assertion,
 *      catching the exact historical regression described in the task.
 *
 * For workshop the analogous checks are:
 *   - Non-empty `seo.description` → `db.update()` NOT called at all.
 *   - Empty `seo.description` → `db.update()` IS called WITH the guard.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { applyAutofill, buildFinding, type AuditFinding } from "./seoAudit.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Non-empty but under the 70-char minimum — triggers seoDescriptionShort. */
const SHORT_DESC = "A brief description.";

/** Rich body text long enough for suggestDescription to exceed 70 chars. */
const RICH_BODY =
  "This paragraph describes the artifact in sufficient detail to produce a " +
  "suggestion that comfortably exceeds the minimum SERP description length " +
  "and is suitable as an autofill replacement.";

// ─── DB mock ─────────────────────────────────────────────────────────────────

interface Capture {
  set: Record<string, unknown>;
  where: unknown;
}

interface MockDb {
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (cond: unknown) => {
        returning: () => Promise<unknown[]>;
      };
    };
  };
  query: {
    workshopsTable: {
      findFirst: (opts: unknown) => Promise<{ seo: { title: string; description: string } } | undefined>;
    };
  };
  captures: Capture[];
}

/**
 * Creates a chainable DB mock that captures (set, where) pairs.
 * `returning` always returns the provided array — pass `[]` to simulate
 * the SQL guard blocking the update (0 rows matched WHERE condition).
 */
function makeCapturingDb(returning: unknown[] = []): MockDb {
  const captures: Capture[] = [];
  return {
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            captures.push({ set: values, where: cond });
            return returning;
          },
        }),
      }),
    }),
    query: {
      workshopsTable: {
        findFirst: async (_opts: unknown) =>
          ({ seo: { title: "", description: SHORT_DESC } }),
      },
    },
    captures,
  };
}

// ─── Guard inspection ────────────────────────────────────────────────────────

/**
 * Recursively walks a Drizzle SQL object's `queryChunks` looking for
 * `StringChunk` nodes whose `.value` array contains the guard text
 * `'is null'` or `'trim('`.
 *
 * If the guard SQL is removed from an `applyAutofill` case branch, no
 * StringChunk in the captured WHERE arg will hold those strings and this
 * function returns `false`, causing the assertion to fail.
 */
function hasEmptyGuard(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object" || depth > 25) return false;
  const obj = node as Record<string, unknown>;

  // StringChunk: { value: readonly string[] }
  if (
    Array.isArray(obj.value) &&
    (obj.value as unknown[]).every((v) => typeof v === "string")
  ) {
    return (obj.value as string[]).some(
      (s) => s.includes("is null") || s.toLowerCase().includes("trim("),
    );
  }

  // SQL / and(): { queryChunks: SQLChunk[] }
  if (Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).some((c) => hasEmptyGuard(c, depth + 1));
  }

  return false;
}

// ─── Finding factory ─────────────────────────────────────────────────────────

/**
 * Builds a seoDescriptionShort finding for the given kind.
 * Uses a numeric id string for "event" since that case parses it with parseInt.
 */
function shortDescFinding(kind: AuditFinding["kind"]): AuditFinding {
  const f = buildFinding({
    kind,
    id: kind === "event" ? "42" : "uuid-test-1",
    slug: "test-slug",
    title: "Test Artifact Title",
    path: `/test/${kind}/test-slug`,
    seoTitle: "A sufficient SEO title",
    seoDescription: SHORT_DESC,
    ogImage: null,
    fallbackImage: null,
    hasEditorImage: true,
    descriptionSources: [RICH_BODY],
  });
  assert.ok(
    f !== null && f.missing.includes("seoDescriptionShort"),
    `precondition failure: ${kind} finding must have seoDescriptionShort in missing`,
  );
  return f!;
}

// ─── Flat-column kinds: db.update called WITH empty-check guard ──────────────
//
// For each kind that stores seoDescription in a flat text column (all except
// workshop), a seoDescriptionShort finding must result in a db.update() call
// whose WHERE clause carries the `(col IS NULL OR TRIM(col) = '')` guard.
//
// If someone removes the guard from a case branch, hasEmptyGuard() returns
// false → the assertion fails → regression detected before it reaches editors.

const FLAT_KINDS: AuditFinding["kind"][] = [
  "insight",
  "service",
  "solution",
  "application",
  "case-study",
  "model",
  "polaris",
  "event",
  "collateral",
];

for (const kind of FLAT_KINDS) {
  test(
    `applyAutofill [${kind}]: seoDescriptionShort → db.update called with empty-check WHERE guard`,
    async () => {
      const finding = shortDescFinding(kind);
      const mockDb = makeCapturingDb([]);

      await applyAutofill([finding], mockDb);

      const descCaptures = mockDb.captures.filter(
        (c) => c.set.seoDescription !== undefined,
      );
      assert.ok(
        descCaptures.length > 0,
        `${kind}: db.update must be called with seoDescription for a seoDescriptionShort finding`,
      );
      assert.ok(
        descCaptures.every((c) => hasEmptyGuard(c.where)),
        `${kind}: every seoDescription update must include the empty-check SQL guard ` +
          `('is null or trim()') to prevent overwriting non-empty values — ` +
          `if this fails, the guard was removed from the ${kind} case branch`,
      );
    },
  );
}

// ─── Flat-column kinds: touched=0 when mock returns [] ──────────────────────
//
// The SQL guard prevents writes on rows that already have a value; the DB
// returns 0 rows for those updates.  Simulate this by having mock return [].

for (const kind of FLAT_KINDS) {
  test(
    `applyAutofill [${kind}]: guard-blocked update (mock returns []) → touched[${kind}] stays 0`,
    async () => {
      const finding = shortDescFinding(kind);
      const mockDb = makeCapturingDb([]); // empty = guard blocked the update
      const touched = await applyAutofill([finding], mockDb);
      assert.equal(
        touched[kind],
        0,
        `${kind}: when the guard prevents the update (0 rows returned), touched must be 0`,
      );
    },
  );
}

// ─── Workshop: JS-level protection ──────────────────────────────────────────
//
// Workshops use a read-modify-write pattern (JSONB seo column).  Before any
// db.update() call, applyAutofill reads the current seo.description value via
// db.query and skips the update when the value is already non-blank.
// This is stronger than a SQL guard: the update never even reaches the DB.

test(
  "applyAutofill [workshop]: non-empty short seo.description → db.update NOT called (JS-level protection)",
  async () => {
    const finding = shortDescFinding("workshop");
    const mockDb = makeCapturingDb([]);
    // findFirst returns a row whose seo.description is non-empty (SHORT_DESC).
    // applyAutofill's JS check `!(seo.description ?? '').trim()` evaluates to
    // false → the description update is skipped entirely → no db.update() call.
    await applyAutofill([finding], mockDb);

    assert.equal(
      mockDb.captures.length,
      0,
      "workshop: db.update must not be called when seo.description is already non-empty",
    );
  },
);

test(
  "applyAutofill [workshop]: empty seo.description → db.update called with empty-check WHERE guard",
  async () => {
    const finding = shortDescFinding("workshop");
    const mockDb = makeCapturingDb([]);
    // Override: findFirst returns a row whose seo.description IS empty.
    // JS check passes → update IS attempted → SQL guard added to WHERE.
    mockDb.query.workshopsTable.findFirst = async (_opts: unknown) =>
      ({ seo: { title: "", description: "" } });

    await applyAutofill([finding], mockDb);

    assert.ok(
      mockDb.captures.length > 0,
      "workshop: db.update must be called when seo.description is empty",
    );
    assert.ok(
      mockDb.captures.every((c) => hasEmptyGuard(c.where)),
      "workshop: empty-check WHERE guard must be present on the update query",
    );
  },
);

test(
  "applyAutofill [workshop]: non-empty short seo.description → touched[workshop] is 0",
  async () => {
    const finding = shortDescFinding("workshop");
    const mockDb = makeCapturingDb([]);
    const touched = await applyAutofill([finding], mockDb);
    assert.equal(
      touched.workshop,
      0,
      "workshop: no update attempted → touched must be 0",
    );
  },
);
