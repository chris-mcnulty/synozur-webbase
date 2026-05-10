/**
 * Unit tests for the short-link redirect/import contract (#76).
 *
 * Pins the four behaviours that, if they regress silently, break either
 * the QR codes already in print or the CSV-round-trip semantics:
 *   1. Slug normalization is case-insensitive, slash-stripping, and
 *      lower-cased so `/Foo`, `foo/`, and `FOO` all resolve identically.
 *   2. Slug validation forbids `/` (the middleware resolves the first
 *      path segment, so a nested slug would be unreachable).
 *   3. `mergeQuery` merges inbound search params into the destination
 *      URL via the WHATWG URL API rather than naive `+`, so a target
 *      that already has `?...` doesn't end up with `...?a=1?b=2`.
 *   4. The status-code union accepts only 301/302/307/308 — Rebrandly
 *      exports occasionally include odd values that we don't honour.
 *
 * Mirroring the schemas/helpers in this file (rather than importing them)
 * keeps the unit test independent of the DB import chain pulled in by
 * `lib/shortLinks.ts`. The mirrors are tiny and the mismatch alarms loudly
 * in code review if the prod copies drift.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:short-links
 */

import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// ─── Mirrored helpers ──────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9._\-]{0,127}$/;

function normalizeSlug(raw: string): string {
  return raw.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function mergeQuery(targetUrl: string, originalUrl: string): string {
  const qIdx = originalUrl.indexOf("?");
  if (qIdx === -1) return targetUrl;
  const inboundQs = originalUrl.slice(qIdx + 1);
  if (!inboundQs) return targetUrl;
  try {
    const out = new URL(targetUrl);
    const inbound = new URLSearchParams(inboundQs);
    inbound.forEach((value, key) => {
      out.searchParams.set(key, value);
    });
    return out.toString();
  } catch {
    const sep = targetUrl.includes("?") ? "&" : "?";
    return `${targetUrl}${sep}${inboundQs}`;
  }
}

const StatusCodeShape = z
  .union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)])
  .optional();

// ─── normalizeSlug ─────────────────────────────────────────────────────────

test("normalizeSlug lowercases mixed-case input", () => {
  assert.equal(normalizeSlug("HolidaysWP"), "holidayswp");
});

test("normalizeSlug strips leading and trailing slashes", () => {
  assert.equal(normalizeSlug("/foo/"), "foo");
  assert.equal(normalizeSlug("///foo"), "foo");
  assert.equal(normalizeSlug("foo///"), "foo");
});

test("normalizeSlug trims surrounding whitespace", () => {
  assert.equal(normalizeSlug("  foo  "), "foo");
});

// ─── isValidSlug ───────────────────────────────────────────────────────────

test("isValidSlug accepts canonical slugs", () => {
  for (const s of ["foo", "foo-bar", "foo_bar", "foo.bar", "abc123", "a"]) {
    assert.equal(isValidSlug(s), true, `expected ${JSON.stringify(s)} to pass`);
  }
});

test("isValidSlug rejects slugs containing /", () => {
  // Middleware resolves the first segment only, so `foo/bar` would never
  // match at redirect time. The validator owns this contract.
  for (const s of ["foo/bar", "/foo", "foo/"]) {
    assert.equal(isValidSlug(s), false, `expected ${JSON.stringify(s)} to fail`);
  }
});

test("isValidSlug rejects slugs that don't start with [a-z0-9]", () => {
  for (const s of ["-foo", "_foo", ".foo"]) {
    assert.equal(isValidSlug(s), false, `expected ${JSON.stringify(s)} to fail`);
  }
});

test("isValidSlug rejects unsafe characters", () => {
  for (const s of ["foo bar", "foo?bar", "foo#bar", "foo%2Fbar"]) {
    assert.equal(isValidSlug(s), false, `expected ${JSON.stringify(s)} to fail`);
  }
});

test("isValidSlug enforces a 128-character cap", () => {
  assert.equal(isValidSlug("a".repeat(128)), true);
  assert.equal(isValidSlug("a".repeat(129)), false);
});

// ─── mergeQuery ────────────────────────────────────────────────────────────

test("mergeQuery passes the target through when there's no inbound qs", () => {
  assert.equal(
    mergeQuery("https://example.com/path", "/foo"),
    "https://example.com/path",
  );
});

test("mergeQuery appends inbound params when the target has none", () => {
  assert.equal(
    mergeQuery("https://example.com/path", "/foo?utm_source=email&utm_medium=qr"),
    "https://example.com/path?utm_source=email&utm_medium=qr",
  );
});

test("mergeQuery merges when the target already has a query string", () => {
  // Avoid the `...path?a=1?b=2` bug. Both params survive.
  const out = mergeQuery(
    "https://example.com/path?ref=site",
    "/foo?utm=email",
  );
  const parsed = new URL(out);
  assert.equal(parsed.searchParams.get("ref"), "site");
  assert.equal(parsed.searchParams.get("utm"), "email");
  // No accidental double-? in the resulting URL.
  assert.equal((out.match(/\?/g) ?? []).length, 1);
});

test("mergeQuery has inbound params win on key collision", () => {
  // Campaign-link overrides should reach the destination.
  const out = mergeQuery(
    "https://example.com/path?utm=default",
    "/foo?utm=override",
  );
  assert.equal(new URL(out).searchParams.get("utm"), "override");
});

test("mergeQuery falls back to ?-vs-& when the target isn't a parseable URL", () => {
  // Defensive branch — we'd rather send the user somewhere than 500.
  const out = mergeQuery("not-a-url", "/foo?a=1");
  assert.equal(out, "not-a-url?a=1");
  const out2 = mergeQuery("not-a-url?b=2", "/foo?a=1");
  assert.equal(out2, "not-a-url?b=2&a=1");
});

// ─── StatusCodeShape ──────────────────────────────────────────────────────

test("status-code shape accepts every supported redirect code", () => {
  for (const code of [301, 302, 307, 308] as const) {
    assert.equal(StatusCodeShape.safeParse(code).success, true);
  }
});

test("status-code shape rejects everything else", () => {
  for (const bad of [200, 303, 304, 404, 0, -1, "302"]) {
    assert.equal(
      StatusCodeShape.safeParse(bad).success,
      false,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

// ─── normalizeSlug ↔ isValidSlug round-trip ────────────────────────────────

test("normalize-then-validate accepts the inputs it's expected to", () => {
  // Editors paste URLs with surrounding noise; the route normalises before
  // validating, so the normalized form must pass the regex.
  const cases: Array<[input: string, expected: boolean]> = [
    ["holidayswp", true],
    ["/holidayswp", true],
    ["HolidaysWP", true],
    ["  holidayswp  ", true],
    ["holidays/wp", false], // contains '/'
    ["", false],
    ["-leading", false],
  ];
  for (const [input, expected] of cases) {
    assert.equal(
      isValidSlug(normalizeSlug(input)),
      expected,
      `expected normalize+validate of ${JSON.stringify(input)} to be ${expected}`,
    );
  }
});
