/**
 * Unit test for query-side synonym expansion in the public search route.
 *
 * `buildTsqueryExpr` rewrites a user-typed query into a SQL expression
 * that evaluates to a tsquery, AND-combining the surviving free-text
 * terms with OR-groups for any matched synonym phrases. Pure string
 * transform — no DB or Express boot — so it's cheap to run on every
 * commit and pins the contract editors rely on when adding aliases to
 * `SYNONYM_GROUPS`.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:search-synonyms
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildTsqueryExpr } from "./search.synonyms";

test("acronym query expands to include the spelled-out phrase", () => {
  const expr = buildTsqueryExpr("AI");
  assert.match(expr, /plainto_tsquery\('english', 'ai'\)/);
  assert.match(expr, /plainto_tsquery\('english', 'artificial intelligence'\)/);
  assert.match(expr, /\|\|/);
});

test("spelled-out phrase expands to include the acronym", () => {
  const expr = buildTsqueryExpr("artificial intelligence");
  assert.match(expr, /plainto_tsquery\('english', 'ai'\)/);
  assert.match(expr, /plainto_tsquery\('english', 'artificial intelligence'\)/);
});

test("synonym in a multi-term query AND's the OR-group with the rest", () => {
  const expr = buildTsqueryExpr("AI strategy");
  assert.match(expr, /\|\|/, "synonyms joined with OR");
  assert.match(expr, /&&/, "remaining term AND-joined");
  assert.match(expr, /plainto_tsquery\('english', 'strategy'\)/);
});

test("longest variant wins so a full phrase doesn't double-trigger", () => {
  // "artificial intelligence" should be consumed as one phrase, not as
  // two separate hits against the "ai" entry and a leftover "intelligence".
  const expr = buildTsqueryExpr("artificial intelligence");
  // Only one OR-group should appear (count `||` occurrences).
  const orCount = (expr.match(/\|\|/g) ?? []).length;
  // Exactly one OR between the two variants in the ai group.
  assert.equal(orCount, 1);
  // No leftover "intelligence" as a free term.
  assert.doesNotMatch(expr, /plainto_tsquery\('english', 'intelligence'\)/);
});

test("non-synonym query falls through to plain plainto_tsquery", () => {
  const expr = buildTsqueryExpr("polaris episode three");
  assert.equal(
    expr,
    `plainto_tsquery('english', 'polaris episode three')`,
  );
});

test("empty input returns a safe empty tsquery", () => {
  const expr = buildTsqueryExpr("");
  assert.equal(expr, `plainto_tsquery('english', '')`);
});

test("single quotes in input are SQL-escaped, not injected", () => {
  const expr = buildTsqueryExpr("o'malley");
  // Doubled single-quote, not a stray closing quote.
  assert.match(expr, /plainto_tsquery\('english', 'o''malley'\)/);
});

test("case-insensitive matching across the dictionary", () => {
  const upper = buildTsqueryExpr("Machine Learning");
  assert.match(upper, /plainto_tsquery\('english', 'ml'\)/);
  assert.match(upper, /plainto_tsquery\('english', 'machine learning'\)/);
});

test("multiple synonym groups in one query each get their own OR-group", () => {
  const expr = buildTsqueryExpr("AI and ML");
  assert.match(expr, /plainto_tsquery\('english', 'artificial intelligence'\)/);
  assert.match(expr, /plainto_tsquery\('english', 'machine learning'\)/);
  // Two synonym groups → at least two `||` operators.
  const orOps = (expr.match(/\|\|/g) ?? []).length;
  assert.ok(orOps >= 2, `expected at least two || ops, got ${orOps} in ${expr}`);
  // And the two groups are AND-joined.
  assert.match(expr, /&&/);
});
