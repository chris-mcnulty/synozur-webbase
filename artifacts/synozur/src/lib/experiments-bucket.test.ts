/**
 * Pure-logic tests for the A/B experiments bucketing math + URL
 * force-override parsing. Run with:
 *   pnpm --filter @workspace/synozur exec node --import tsx --test \
 *     src/lib/experiments-bucket.test.ts
 *
 * No DB, no React — these exist to pin the bucketing contract so a
 * future refactor of `pickVariant` can't silently change which
 * visitors land in which variant.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  cyrb53,
  pickVariant,
  pageScopeForKey,
  parseForcedFromQuery,
  HOLDBACK_VARIANT_KEY,
  type ExperimentPublic,
} from "./experiments-bucket";

function makeExperiment(overrides: Partial<ExperimentPublic> = {}): ExperimentPublic {
  return {
    key: "test_exp",
    pageKey: "home",
    trafficPercentage: 100,
    holdbackPercentage: 0,
    conversionPaths: [],
    variants: [
      {
        key: "control",
        name: "Control",
        isControl: true,
        weight: 50,
        overrides: {},
      },
      {
        key: "variant",
        name: "Variant",
        isControl: false,
        weight: 50,
        overrides: { "home.hero.cta.label": "Try it free" },
      },
    ],
    ...overrides,
  };
}

test("cyrb53: deterministic for the same input", () => {
  assert.equal(cyrb53("foo"), cyrb53("foo"));
  assert.equal(cyrb53("foo:bar"), cyrb53("foo:bar"));
});

test("cyrb53: different inputs produce different outputs", () => {
  assert.notEqual(cyrb53("foo"), cyrb53("bar"));
  assert.notEqual(cyrb53("v1:exp"), cyrb53("v2:exp"));
});

test("cyrb53: distribution across 100 buckets is roughly uniform", () => {
  const counts = new Array(100).fill(0);
  const N = 10_000;
  for (let i = 0; i < N; i++) {
    const bucket = cyrb53(`visitor-${i}:test_exp`) % 100;
    counts[bucket] += 1;
  }
  // Expected ~100 per bucket. χ² test would be more rigorous, but a
  // simple max-deviation check catches gross bias.
  const expected = N / 100;
  const maxDeviation = Math.max(...counts.map((c) => Math.abs(c - expected)));
  assert.ok(
    maxDeviation < expected * 0.5,
    `bucket distribution too skewed: max deviation ${maxDeviation} > 50% of expected ${expected}`,
  );
});

test("pickVariant: returns null for empty variants", () => {
  const exp = makeExperiment({ variants: [] });
  assert.equal(pickVariant("v1", exp), null);
});

test("pickVariant: deterministic for same (visitor, experiment)", () => {
  const exp = makeExperiment();
  const a = pickVariant("alice", exp);
  const b = pickVariant("alice", exp);
  assert.deepEqual(a, b);
});

test("pickVariant: different visitors can land in different variants", () => {
  const exp = makeExperiment();
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const v = pickVariant(`visitor-${i}`, exp);
    if (v) seen.add(v.key);
  }
  // Both variants should be picked at least once across 200 samples
  // when weights are 50/50.
  assert.ok(seen.has("control"), "control was never picked");
  assert.ok(seen.has("variant"), "variant was never picked");
});

test("pickVariant: 50/50 weights produce ~50/50 split", () => {
  const exp = makeExperiment();
  const counts: Record<string, number> = { control: 0, variant: 0 };
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const v = pickVariant(`visitor-${i}`, exp);
    if (v) counts[v.key]! += 1;
  }
  // Each side should be within 10% of expected.
  for (const k of ["control", "variant"]) {
    const ratio = counts[k]! / N;
    assert.ok(
      ratio > 0.4 && ratio < 0.6,
      `${k} ratio ${ratio} outside [0.4, 0.6]`,
    );
  }
});

test("pickVariant: returns null when bucket >= trafficPercentage (out of test)", () => {
  // With trafficPercentage=0 every visitor is out-of-test.
  const exp = makeExperiment({ trafficPercentage: 0 });
  for (let i = 0; i < 50; i++) {
    assert.equal(pickVariant(`visitor-${i}`, exp), null);
  }
});

test("pickVariant: ~50% of visitors are out-of-test when trafficPercentage=50", () => {
  const exp = makeExperiment({ trafficPercentage: 50 });
  let nullCount = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    if (pickVariant(`visitor-${i}`, exp) === null) nullCount += 1;
  }
  const ratio = nullCount / N;
  assert.ok(
    ratio > 0.4 && ratio < 0.6,
    `out-of-test ratio ${ratio} outside [0.4, 0.6]`,
  );
});

test("pickVariant: holdbackPercentage routes a slice to the synthetic _holdback variant", () => {
  // 100% in-test, 50% of in-test in holdback. Real variants split the
  // remaining 50%. Expect roughly: 50% holdback, 25% control, 25% variant.
  const exp = makeExperiment({
    trafficPercentage: 100,
    holdbackPercentage: 50,
  });
  const counts: Record<string, number> = {
    [HOLDBACK_VARIANT_KEY]: 0,
    control: 0,
    variant: 0,
  };
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const v = pickVariant(`visitor-${i}`, exp);
    if (v) counts[v.key]! += 1;
  }
  assert.ok(
    counts[HOLDBACK_VARIANT_KEY]! / N > 0.4 &&
      counts[HOLDBACK_VARIANT_KEY]! / N < 0.6,
    `holdback ratio ${counts[HOLDBACK_VARIANT_KEY]! / N} outside [0.4, 0.6]`,
  );
  assert.ok(counts.control! > 500, "control got too few samples");
  assert.ok(counts.variant! > 500, "variant got too few samples");
});

test("pickVariant: weighted variants honor the configured ratio", () => {
  // 80/20 control/variant split.
  const exp = makeExperiment({
    variants: [
      {
        key: "control",
        name: "Control",
        isControl: true,
        weight: 80,
        overrides: {},
      },
      {
        key: "variant",
        name: "Variant",
        isControl: false,
        weight: 20,
        overrides: {},
      },
    ],
  });
  const counts: Record<string, number> = { control: 0, variant: 0 };
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const v = pickVariant(`visitor-${i}`, exp);
    if (v) counts[v.key]! += 1;
  }
  // Within ±5 percentage points of target.
  const controlRatio = counts.control! / N;
  const variantRatio = counts.variant! / N;
  assert.ok(
    controlRatio > 0.75 && controlRatio < 0.85,
    `control ratio ${controlRatio} outside [0.75, 0.85]`,
  );
  assert.ok(
    variantRatio > 0.15 && variantRatio < 0.25,
    `variant ratio ${variantRatio} outside [0.15, 0.25]`,
  );
});

test("pageScopeForKey: extracts namespace before first dot", () => {
  assert.equal(pageScopeForKey("home.hero.cta.visible"), "home");
  assert.equal(pageScopeForKey("services.hero.headline"), "services");
  assert.equal(pageScopeForKey("case-studies.hero.body"), "case-studies");
});

test("pageScopeForKey: header.* keys return null (site-wide)", () => {
  assert.equal(pageScopeForKey("header.cta.visible"), null);
  assert.equal(pageScopeForKey("header.cta.label"), null);
});

test("pageScopeForKey: keys without a dot return null", () => {
  assert.equal(pageScopeForKey("homepage"), null);
  assert.equal(pageScopeForKey(""), null);
});

test("parseForcedFromQuery: returns null when _exp is absent", () => {
  assert.equal(parseForcedFromQuery("?other=1", []), null);
  assert.equal(parseForcedFromQuery("", []), null);
});

test("parseForcedFromQuery: clears when _exp=clear or empty", () => {
  const existing = [{ experimentKey: "exp1", variantKey: "v1" }];
  assert.deepEqual(parseForcedFromQuery("?_exp=clear", existing), []);
  assert.deepEqual(parseForcedFromQuery("?_exp=", existing), []);
});

test("parseForcedFromQuery: parses single experiment:variant pair", () => {
  assert.deepEqual(parseForcedFromQuery("?_exp=exp1:v1", []), [
    { experimentKey: "exp1", variantKey: "v1" },
  ]);
});

test("parseForcedFromQuery: parses comma-separated multiple", () => {
  assert.deepEqual(parseForcedFromQuery("?_exp=exp1:v1,exp2:v2", []), [
    { experimentKey: "exp1", variantKey: "v1" },
    { experimentKey: "exp2", variantKey: "v2" },
  ]);
});

test("parseForcedFromQuery: merges with existing list, overriding same-key entries", () => {
  const existing = [
    { experimentKey: "exp1", variantKey: "v1" },
    { experimentKey: "exp2", variantKey: "v2" },
  ];
  // Override exp1, leave exp2.
  assert.deepEqual(
    parseForcedFromQuery("?_exp=exp1:v1b", existing),
    [
      { experimentKey: "exp2", variantKey: "v2" },
      { experimentKey: "exp1", variantKey: "v1b" },
    ],
  );
});

test("parseForcedFromQuery: ignores malformed pairs", () => {
  assert.deepEqual(parseForcedFromQuery("?_exp=exp1,exp2:v2", []), [
    { experimentKey: "exp2", variantKey: "v2" },
  ]);
});
