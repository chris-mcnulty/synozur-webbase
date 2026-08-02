/**
 * Test suite: RSS feed <description> completeness.
 *
 * Part A — Unit tests for trimToSentence(), looksComplete(), and
 * descriptionFor().  These run without a DB or HTTP server and cover the
 * edge-case branches that previously caused mid-sentence truncation:
 *
 *   (a) Off-by-one threshold in trimToSentence() fell back to a word
 *       boundary, yielding a description that ended on an arbitrary word.
 *   (b) A single long-sentence excerpt was cut at exactly 300 chars —
 *       mid-sentence — because no ". " boundary was found in the window.
 *
 * Part B — Integration smoke-test: start the Express app, fetch the live
 * /api/insights/rss.xml route, and assert that every <description> element
 * in the feed looks like a complete sentence (not truncated).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rss-descriptions
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { pool } from "@workspace/db";
import app from "../app";
import {
  trimToSentence,
  looksComplete,
  descriptionFor,
  ABSTRACT_MAX,
} from "./rssDescriptions";

// ─── Part A: Unit tests ────────────────────────────────────────────────────────

// Helper: build a string of exactly `len` chars ending with the given suffix.
function padTo(len: number, suffix = " lorem ipsum dolor"): string {
  const base = "A".repeat(len);
  return (base + suffix).slice(0, len);
}

// ── looksComplete ──────────────────────────────────────────────────────────────

test("looksComplete: returns true for text ending with period", () => {
  assert.ok(looksComplete("This is a sentence."));
});

test("looksComplete: returns true for text ending with exclamation", () => {
  assert.ok(looksComplete("Watch out!"));
});

test("looksComplete: returns true for text ending with question mark", () => {
  assert.ok(looksComplete("Is this complete?"));
});

test('looksComplete: returns true for period followed by closing quote (straight ")', () => {
  assert.ok(looksComplete('He said, "Done."'));
});

test("looksComplete: returns true for period followed by closing curly quote (\u201d)", () => {
  assert.ok(looksComplete("He said, \u201cDone.\u201d"));
});

test("looksComplete: returns true for period followed by closing paren", () => {
  assert.ok(looksComplete("A valid point (obviously)."));
});

test("looksComplete: returns false for text ending mid-word", () => {
  assert.ok(!looksComplete("This is cut off mid"));
});

test("looksComplete: returns false for text ending with a comma", () => {
  assert.ok(!looksComplete("First item, second item,"));
});

test("looksComplete: returns false for empty string", () => {
  assert.ok(!looksComplete(""));
});

// ── trimToSentence ─────────────────────────────────────────────────────────────

test("trimToSentence: text shorter than maxLen is returned unchanged", () => {
  const text = "Short sentence.";
  assert.equal(trimToSentence(text), text);
});

test("trimToSentence: text exactly at maxLen is returned unchanged", () => {
  // Construct a string that is exactly ABSTRACT_MAX chars and ends with a sentence.
  const tail = ". Ends here.";
  const filler = "X".repeat(ABSTRACT_MAX - tail.length);
  const text = filler + tail;
  assert.equal(text.length, ABSTRACT_MAX);
  assert.equal(trimToSentence(text), text);
});

test("trimToSentence: trims at last '. ' boundary inside the window", () => {
  // Build: [200 chars]. Second sentence here. [padding to 600 chars]
  const first = "A".repeat(200);
  const second = " Second sentence here.";
  const filler = " " + "Z".repeat(600 - first.length - second.length - 1);
  const text = first + "." + second + filler;
  assert.ok(text.length > ABSTRACT_MAX);

  const result = trimToSentence(text);
  // Must end at the sentence after "Second sentence here."
  assert.ok(looksComplete(result), `Expected sentence-final punctuation, got: "${result.slice(-30)}"`);
  assert.ok(result.length <= ABSTRACT_MAX, `Result is longer than ABSTRACT_MAX: ${result.length}`);
});

test("trimToSentence: trims at last '! ' boundary when no '. ' is present", () => {
  const first = "Watch out! ";
  // Pad to push total over ABSTRACT_MAX, with no ". " present
  const rest = "no dots here " + "X".repeat(500);
  const text = first + rest;
  assert.ok(text.length > ABSTRACT_MAX);

  const result = trimToSentence(text);
  // The last ". " is absent but "! " was found — result must end with "!"
  assert.ok(
    result.endsWith("!"),
    `Expected result to end with "!", got: "…${result.slice(-20)}"`,
  );
});

test("trimToSentence: trims at last '? ' boundary when no '. ' or '! ' is present", () => {
  const first = "Is this working? ";
  const rest = "no dots or bangs " + "X".repeat(500);
  const text = first + rest;
  assert.ok(text.length > ABSTRACT_MAX);

  const result = trimToSentence(text);
  assert.ok(
    result.endsWith("?"),
    `Expected result to end with "?", got: "…${result.slice(-20)}"`,
  );
});

test("trimToSentence: falls back to word boundary + ellipsis when no sentence boundary found", () => {
  // One continuous word (no spaces, no sentence punctuation) longer than maxLen.
  const text = "A".repeat(ABSTRACT_MAX + 50);
  const result = trimToSentence(text);
  // No space → slices at maxLen, appends ellipsis.
  assert.ok(
    result.endsWith("…"),
    `Expected ellipsis fallback, got: "…${result.slice(-20)}"`,
  );
});

test("trimToSentence: word-boundary fallback appends ellipsis", () => {
  // Text with a space but no sentence boundary.
  const text = "word ".repeat(200); // well over ABSTRACT_MAX, no ". "/"! "/"? "
  const result = trimToSentence(text);
  assert.ok(result.endsWith("…"), `Expected ellipsis, got: "…${result.slice(-20)}"`);
  assert.ok(result.length <= ABSTRACT_MAX + 1, `Result too long: ${result.length}`);
});

test("trimToSentence: custom maxLen is respected", () => {
  const text = "First sentence. Second sentence. Third sentence.";
  const result = trimToSentence(text, 20);
  assert.ok(result.length <= 20, `Result length ${result.length} exceeds custom maxLen 20`);
  assert.ok(looksComplete(result), `Expected sentence-final punctuation, got: "${result}"`);
});

// ── descriptionFor ─────────────────────────────────────────────────────────────

test("descriptionFor: clean excerpt wins over seoDescription and bodyHtml", () => {
  const post = {
    excerpt: "This is a complete excerpt.",
    seoDescription: "SEO copy.",
    bodyHtml: "<p>Body text.</p>",
  };
  assert.equal(descriptionFor(post), "This is a complete excerpt.");
});

test("descriptionFor: incomplete excerpt falls through to seoDescription", () => {
  const post = {
    excerpt: "This excerpt is cut off mid", // not complete
    seoDescription: "Complete SEO description.",
    bodyHtml: "<p>Body text.</p>",
  };
  assert.equal(descriptionFor(post), "Complete SEO description.");
});

test("descriptionFor: incomplete seoDescription falls through to bodyHtml", () => {
  const post = {
    excerpt: "Incomplete excerpt",
    seoDescription: "Incomplete SEO",
    bodyHtml: "<p>Body paragraph one. Body paragraph two.</p>",
  };
  const result = descriptionFor(post);
  // Body text is extracted and trimmed
  assert.ok(result.length > 0);
  assert.ok(
    result.includes("Body paragraph"),
    `Expected body text in result, got: "${result}"`,
  );
});

test("descriptionFor: excerpt longer than ABSTRACT_MAX is trimmed at sentence boundary", () => {
  const longExcerpt =
    "First sentence is short. " +
    "Second sentence fills space. " +
    "X".repeat(500) +
    " trailing stuff.";
  // Make sure it looks complete (ends with ".")
  const post = {
    excerpt: longExcerpt,
    seoDescription: null,
    bodyHtml: null,
  };
  const result = descriptionFor(post);
  assert.ok(result.length <= ABSTRACT_MAX, `Result too long: ${result.length}`);
  assert.ok(looksComplete(result), `Expected complete sentence, got: "…${result.slice(-30)}"`);
});

test("descriptionFor: last resort uses incomplete excerpt when no other source", () => {
  const post = {
    excerpt: "Incomplete excerpt without punctuation",
    seoDescription: null,
    bodyHtml: null,
  };
  const result = descriptionFor(post);
  // trimToSentence on an incomplete excerpt ≤ ABSTRACT_MAX returns it unchanged
  assert.equal(result, "Incomplete excerpt without punctuation");
});

test("descriptionFor: last resort uses incomplete seoDescription when excerpt is missing", () => {
  const post = {
    excerpt: null,
    seoDescription: "Incomplete SEO description",
    bodyHtml: null,
  };
  const result = descriptionFor(post);
  assert.equal(result, "Incomplete SEO description");
});

test("descriptionFor: returns empty string when all sources are empty/null", () => {
  const post = {
    excerpt: null,
    seoDescription: null,
    bodyHtml: null,
  };
  assert.equal(descriptionFor(post), "");
});

test("descriptionFor: seoDescription trimmed to sentence boundary is used even if shorter than original", () => {
  // seoDescription that is long but complete, and trimToSentence reduces it to a
  // shorter but still-complete form.
  const seo =
    "First sentence. " + "B".repeat(500) + " end without period";
  const post = {
    excerpt: null,
    seoDescription: seo,
    bodyHtml: null,
  };
  // seo does NOT look complete (ends without punctuation), so it falls through
  // to bodyHtml (null here), then last-resort seo path.
  const result = descriptionFor(post);
  // trimToSentence will find ". " boundary and trim there
  assert.ok(looksComplete(result), `Expected complete sentence, got: "…${result.slice(-30)}"`);
});

test("descriptionFor: bodyHtml is stripped of tags before trimming", () => {
  const post = {
    excerpt: "Not complete",
    seoDescription: "Not complete either",
    bodyHtml:
      "<h1>Heading</h1><p>First paragraph sentence. Second paragraph sentence.</p>",
  };
  const result = descriptionFor(post);
  assert.ok(!result.includes("<"), `Result should not contain HTML tags: "${result}"`);
  assert.ok(!result.includes(">"), `Result should not contain HTML tags: "${result}"`);
});

// ─── Part B: Integration smoke-test ───────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await pool.end();
});

/**
 * Pull every CDATA-wrapped or plain <description> value from RSS XML.
 * Returns the inner text of each element (CDATA wrapper stripped).
 */
function parseDescriptions(xml: string): string[] {
  const results: string[] = [];
  // Match <description>...</description> blocks (non-greedy, dotAll).
  const blockRe = /<description>([\s\S]*?)<\/description>/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(xml)) !== null) {
    let inner = blockMatch[1];
    // Strip CDATA wrapper if present: <![CDATA[...]]>
    const cdataMatch = inner.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
    if (cdataMatch) {
      inner = cdataMatch[1];
    }
    inner = inner.trim();
    results.push(inner);
  }
  return results;
}

test("RSS feed responds with 200 and RSS content-type", async () => {
  const res = await fetch(`${baseUrl}/api/insights/rss.xml`);
  assert.equal(res.status, 200, `Expected HTTP 200 from /api/insights/rss.xml, got ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  assert.ok(
    ct.includes("rss") || ct.includes("xml"),
    `Expected RSS/XML content-type, got "${ct}"`,
  );
});

test("RSS <description> elements are complete and non-truncated", async () => {
  const res = await fetch(`${baseUrl}/api/insights/rss.xml`);
  assert.equal(res.status, 200);
  const xml = await res.text();

  const all = parseDescriptions(xml);

  // The first <description> is the channel-level description (not a post).
  // Post-level descriptions start at index 1.
  const postDescriptions = all.slice(1);

  if (postDescriptions.length === 0) {
    // No published posts — nothing to assert. The RSS-200 test above still runs.
    return;
  }

  // Sentence-final punctuation: . ! ? optionally followed by one closing
  // quote or paren character (straight or curly), then end-of-string.
  const sentenceFinalRe = /[.!?]["')\u2019\u201d]?\s*$/;

  // Ellipsis patterns that signal truncation rather than a complete thought.
  const ellipsisRe = /(\u2026|\.\.\.)\s*$/;

  const failures: string[] = [];

  for (let i = 0; i < postDescriptions.length; i++) {
    const desc = postDescriptions[i];
    const label = `Item ${i + 1}`;

    // (1) Must end with sentence-final punctuation.
    if (!sentenceFinalRe.test(desc)) {
      failures.push(
        `${label}: description does not end with sentence-final punctuation (. ! ?).\n` +
          `  Last 80 chars: "…${desc.slice(-80)}"\n` +
          `  This indicates a word-boundary fallback from trimToSentence() — ` +
          `the excerpt or body text was cut mid-sentence before reaching LinkedIn.`,
      );
    }

    // (2) Must not end with an ellipsis.
    if (ellipsisRe.test(desc)) {
      failures.push(
        `${label}: description ends with an ellipsis ("…" or "..."), indicating ` +
          `it was truncated rather than completed.\n` +
          `  Last 80 chars: "…${desc.slice(-80)}"`,
      );
    }
  }

  assert.equal(
    failures.length,
    0,
    `${failures.length} RSS description(s) failed completeness checks:\n\n` +
      failures.join("\n\n"),
  );
});
