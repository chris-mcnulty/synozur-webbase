/**
 * Smoke-test suite: RSS feed <description> completeness.
 *
 * Two historical bugs caused post summaries to end mid-sentence before
 * reaching LinkedIn:
 *   (a) An off-by-one threshold in trimToSentence() fell back to a word
 *       boundary, yielding a description that ended on an arbitrary word.
 *   (b) A single long-sentence excerpt was cut at exactly 300 chars —
 *       mid-sentence — because no ". " boundary was found in the window.
 *
 * LinkedIn auto-publishes from <description> and shows roughly the first
 * 200 chars with no "See more" expansion. A truncated description ships a
 * fragment to every follower.
 *
 * For every <description> in the live RSS feed this test asserts:
 *   (1) The value ends with sentence-final punctuation (. ! ? or a closing
 *       quote/paren that immediately follows such punctuation) — i.e. it
 *       looks like a complete thought.
 *   (2) The value does NOT end with an ellipsis (… or ...) — those signal a
 *       teaser/truncation, not a feed summary.
 *
 * The test starts a real Express server (same pattern as ogDynamicImages.test.ts)
 * and hits the live /api/insights/rss.xml route so it exercises descriptionFor(),
 * looksComplete(), and trimToSentence() end-to-end.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:rss-descriptions
 *
 * Hits the real DATABASE_URL (dev is the primary content DB). Read-only.
 */
process.env["EMAIL_DISABLED"] = "1";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { pool } from "@workspace/db";
import app from "../app";

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

// ─── Fetch and parse the feed ─────────────────────────────────────────────────

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
