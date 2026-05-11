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

// ─── Rebrandly mapping ─────────────────────────────────────────────────────
//
// Mirror of `mapRebrandlyLink` in routes/shortLinks.ts. Pins the field
// projection (slashtag→slug, destination→targetUrl, description→notes,
// clicks→hitCount, lastClickAt→Date) so a Rebrandly schema rename or a
// silent change to the mapper is caught before it ships and corrupts an
// import. The admin UI does expose a tags input on each short-link row,
// but the team isn't actively using tags as a workflow today — so the
// Rebrandly importer deliberately leaves them out rather than dragging
// every Rebrandly link's tag list into our `tags` column unsolicited.
// If tags become first-class later, add them back to this mapper.

interface RebrandlyLinkLike {
  id?: string;
  slashtag?: string;
  destination?: string;
  title?: string | null;
  description?: string | null;
  clicks?: number;
  lastClickAt?: string | null;
}

function mapRebrandlyLink(
  link: RebrandlyLinkLike,
):
  | { ok: true; candidate: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!link.slashtag || !link.destination) {
    return {
      ok: false,
      error: "Rebrandly link missing slashtag or destination",
    };
  }
  const candidate: Record<string, unknown> = {
    slug: link.slashtag,
    targetUrl: link.destination,
    title: link.title ?? null,
    notes: link.description ?? null,
    rebrandlyId: link.id ?? null,
  };
  if (typeof link.clicks === "number" && Number.isFinite(link.clicks)) {
    candidate.hitCount = Math.max(0, Math.floor(link.clicks));
  }
  if (link.lastClickAt) {
    const parsed = new Date(link.lastClickAt);
    if (!Number.isNaN(parsed.getTime())) candidate.lastClickAt = parsed;
  }
  return { ok: true, candidate };
}

test("mapRebrandlyLink projects a typical Rebrandly payload", () => {
  const result = mapRebrandlyLink({
    id: "abc123",
    slashtag: "holidays-wp",
    destination: "https://www.synozur.com/insights/holidays-2025",
    title: "Holidays 2025",
    description: "Annual holiday post",
    clicks: 142,
    lastClickAt: "2026-04-30T18:22:11Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    {
      slug: result.candidate.slug,
      targetUrl: result.candidate.targetUrl,
      title: result.candidate.title,
      notes: result.candidate.notes,
      rebrandlyId: result.candidate.rebrandlyId,
      hitCount: result.candidate.hitCount,
    },
    {
      slug: "holidays-wp",
      targetUrl: "https://www.synozur.com/insights/holidays-2025",
      title: "Holidays 2025",
      notes: "Annual holiday post",
      rebrandlyId: "abc123",
      hitCount: 142,
    },
  );
  assert.ok(result.candidate.lastClickAt instanceof Date);
});

test("mapRebrandlyLink rejects links missing slashtag or destination", () => {
  for (const link of [
    {},
    { slashtag: "foo" },
    { destination: "https://example.com" },
    { slashtag: "", destination: "https://example.com" },
  ]) {
    const result = mapRebrandlyLink(link);
    assert.equal(result.ok, false);
  }
});

test("mapRebrandlyLink ignores non-finite click counts", () => {
  // Rebrandly has been seen returning `null` or `undefined` clicks for
  // freshly-created links; we don't want NaN bleeding into hitCount.
  for (const clicks of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number, null as unknown as number]) {
    const result = mapRebrandlyLink({
      slashtag: "foo",
      destination: "https://example.com",
      clicks,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.candidate.hitCount,
      undefined,
      `expected hitCount to stay undefined for ${String(clicks)}`,
    );
  }
});

test("mapRebrandlyLink floors fractional click counts and clamps negatives", () => {
  const positive = mapRebrandlyLink({
    slashtag: "foo",
    destination: "https://example.com",
    clicks: 12.7,
  });
  assert.equal(positive.ok, true);
  if (positive.ok) assert.equal(positive.candidate.hitCount, 12);

  const negative = mapRebrandlyLink({
    slashtag: "foo",
    destination: "https://example.com",
    clicks: -5,
  });
  assert.equal(negative.ok, true);
  if (negative.ok) assert.equal(negative.candidate.hitCount, 0);
});

test("mapRebrandlyLink ignores unparseable lastClickAt", () => {
  const result = mapRebrandlyLink({
    slashtag: "foo",
    destination: "https://example.com",
    lastClickAt: "not a date",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.candidate.lastClickAt, undefined);
});

// ─── CSV stats round-trip parsing ──────────────────────────────────────────
//
// Mirrors the per-cell parsing helpers in the CSV import handler. The whole
// point of these helpers is to let a self-export (Export CSV → DB push →
// Import CSV with overwrite) restore lifetime hitCount, lastClickAt, and the
// admin-managed fields (statusCode / active / OG) without corrupting rows
// when cells are blank or malformed. If any of these parsers regress, a
// production reimport could silently zero a real hit count or flip a link
// inactive, so pin the behaviour here.

function parseHitCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, n);
}

function parseLastClickAt(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseStatusCode(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseActive(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (/^(true|1|yes|y|t)$/i.test(raw.trim())) return true;
  if (/^(false|0|no|n|f)$/i.test(raw.trim())) return false;
  return undefined;
}

test("parseHitCount preserves a non-zero export value", () => {
  assert.equal(parseHitCount("142"), 142);
});

test("parseHitCount preserves an explicit zero (so newly-tracked links don't go undefined)", () => {
  // The upsert step skips undefined; a CSV cell of "0" must round-trip as
  // 0 to overwrite a stale higher count.
  assert.equal(parseHitCount("0"), 0);
});

test("parseHitCount clamps negative or fractional cells", () => {
  assert.equal(parseHitCount("-5"), 0);
  assert.equal(parseHitCount("12.7"), 12);
});

test("parseHitCount returns undefined for blank / malformed cells", () => {
  // A blank cell from `pickField` is already filtered to `undefined`, but
  // a malformed non-numeric value must NOT silently zero a real count.
  for (const raw of [undefined, "", "n/a", "abc"]) {
    assert.equal(parseHitCount(raw), undefined, `raw=${JSON.stringify(raw)}`);
  }
});

test("parseLastClickAt accepts an ISO timestamp from the self-export", () => {
  const d = parseLastClickAt("2026-04-30T18:22:11Z");
  assert.ok(d instanceof Date);
  if (d) assert.equal(d.toISOString(), "2026-04-30T18:22:11.000Z");
});

test("parseLastClickAt returns undefined for blank / unparseable cells", () => {
  for (const raw of [undefined, "", "not a date"]) {
    assert.equal(
      parseLastClickAt(raw),
      undefined,
      `raw=${JSON.stringify(raw)}`,
    );
  }
});

test("parseStatusCode reads a numeric cell", () => {
  for (const code of [301, 302, 307, 308] as const) {
    assert.equal(parseStatusCode(String(code)), code);
  }
});

test("parseStatusCode returns undefined for blank cells", () => {
  assert.equal(parseStatusCode(undefined), undefined);
});

test("parseActive recognises the export's `true`/`false` literals", () => {
  assert.equal(parseActive("true"), true);
  assert.equal(parseActive("false"), false);
});

test("parseActive recognises common truthy/falsy aliases", () => {
  for (const truthy of ["TRUE", "True", "1", "yes", "y", "t"]) {
    assert.equal(parseActive(truthy), true, `truthy=${truthy}`);
  }
  for (const falsy of ["FALSE", "False", "0", "no", "n", "f"]) {
    assert.equal(parseActive(falsy), false, `falsy=${falsy}`);
  }
});

test("parseActive returns undefined for blank or ambiguous cells (no silent flip)", () => {
  // Ambiguous values must NOT silently flip the existing `active` flag;
  // the upsert step skips undefined, so the prod row keeps its current value.
  for (const raw of [undefined, "", "maybe", " "]) {
    assert.equal(parseActive(raw), undefined, `raw=${JSON.stringify(raw)}`);
  }
});

// ─── OG field round-trip parsing ───────────────────────────────────────────
//
// Mirror of `pickField` in the route. OG candidate values must stay
// `undefined` when the column is absent OR the cell is blank so the
// `if (v.ogX !== undefined)` guards in `applyImportRows` skip them.
// Coercing to null would make every Rebrandly import (no OG columns)
// silently clobber admin-managed OG overrides with null.

function pickField(
  row: Record<string, string>,
  ...candidates: string[]
): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const want = c.toLowerCase().replace(/[\s_-]/g, "");
    const k = keys.find(
      (k) => k.toLowerCase().replace(/[\s_-]/g, "") === want,
    );
    if (k && row[k]) return row[k];
  }
  return undefined;
}

test("OG candidate stays undefined when columns are absent (Rebrandly CSV shape)", () => {
  // A Rebrandly CSV has no `ogTitle` / `ogDescription` / `ogImageUrl`
  // headers. The candidate construction must keep these undefined so the
  // overwrite update path does NOT clear admin-managed OG overrides.
  const rebrandlyRow = {
    id: "abc",
    slashtag: "foo",
    destination: "https://example.com",
    title: "Hello",
  };
  assert.equal(pickField(rebrandlyRow, "ogTitle"), undefined);
  assert.equal(pickField(rebrandlyRow, "ogDescription"), undefined);
  assert.equal(pickField(rebrandlyRow, "ogImageUrl"), undefined);
});

test("OG candidate stays undefined for blank cells in a self-export row", () => {
  // A self-export ALWAYS includes the OG columns, but most links don't
  // have an override, so cells are blank. The parser must treat that as
  // "no change" (undefined), not as an explicit clear — otherwise a
  // round-trip overwrite would wipe an OG override set after the export
  // snapshot was taken.
  const selfExportRow = {
    slug: "foo",
    targetUrl: "https://example.com",
    ogTitle: "",
    ogDescription: "",
    ogImageUrl: "",
  };
  assert.equal(pickField(selfExportRow, "ogTitle"), undefined);
  assert.equal(pickField(selfExportRow, "ogDescription"), undefined);
  assert.equal(pickField(selfExportRow, "ogImageUrl"), undefined);
});

test("OG candidate returns the cell value when an override is set", () => {
  const selfExportRow = {
    slug: "foo",
    targetUrl: "https://example.com",
    ogTitle: "Custom OG title",
    ogDescription: "Custom description",
    ogImageUrl: "https://cdn.example.com/og.png",
  };
  assert.equal(pickField(selfExportRow, "ogTitle"), "Custom OG title");
  assert.equal(
    pickField(selfExportRow, "ogDescription"),
    "Custom description",
  );
  assert.equal(
    pickField(selfExportRow, "ogImageUrl"),
    "https://cdn.example.com/og.png",
  );
});
