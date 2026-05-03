/**
 * #167 — Prompt-cache marker shape regression test.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:prompt-cache
 *
 * The cache-control marker shape is a wire-level contract with the Anthropic
 * API. An SDK upgrade that renames `cache_control` or changes the
 * `{ type: "ephemeral" }` shape would silently regress every chat turn back
 * to non-cached billing — no error, just a 10× cost spike on the next
 * invoice. These tests pin the shape directly.
 *
 * The "cold-cache vs warm-cache" coverage exercises the streaming-usage
 * accumulator against synthetic `message_start` / `message_delta` events
 * carrying both flavors of usage payload, so the persistence side of the
 * pipeline can't silently drop a renamed field either.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyHistoryCacheMarkers,
  applyToolCacheMarkers,
  buildCachedSystemBlocks,
  cacheHitRate,
  emptyCacheUsage,
  mergeMessageDeltaUsage,
  mergeMessageStartUsage,
} from "./promptCache.js";

test("buildCachedSystemBlocks: returns a single text block with ephemeral marker", () => {
  const blocks = buildCachedSystemBlocks("you are a helpful assistant");
  assert.deepEqual(blocks, [
    {
      type: "text",
      text: "you are a helpful assistant",
      cache_control: { type: "ephemeral" },
    },
  ]);
});

test("buildCachedSystemBlocks: returns undefined for an empty prompt", () => {
  assert.equal(buildCachedSystemBlocks(""), undefined);
});

test("applyHistoryCacheMarkers: marks last assistant message and appends current user", () => {
  const out = applyHistoryCacheMarkers(
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ],
    "u3",
  );
  assert.equal(out.length, 5);
  assert.deepEqual(out[0], { role: "user", content: "u1" });
  assert.deepEqual(out[1], { role: "assistant", content: "a1" });
  assert.deepEqual(out[2], { role: "user", content: "u2" });
  assert.deepEqual(out[3], {
    role: "assistant",
    content: [
      { type: "text", text: "a2", cache_control: { type: "ephemeral" } },
    ],
  });
  assert.deepEqual(out[4], { role: "user", content: "u3" });
});

test("applyHistoryCacheMarkers: never marks a user message even if it is last", () => {
  const out = applyHistoryCacheMarkers(
    [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ],
    "u3",
  );
  // a1 is the last assistant — it's the one that gets marked.
  assert.deepEqual(out[1], {
    role: "assistant",
    content: [
      { type: "text", text: "a1", cache_control: { type: "ephemeral" } },
    ],
  });
  // The two user messages stay as plain strings; the current turn must never
  // carry a cache marker (it's the part that makes the turn unique).
  assert.deepEqual(out[0], { role: "user", content: "u1" });
  assert.deepEqual(out[2], { role: "user", content: "u2" });
  assert.deepEqual(out[3], { role: "user", content: "u3" });
});

test("applyHistoryCacheMarkers: empty history returns just the current user message", () => {
  const out = applyHistoryCacheMarkers([], "hello");
  assert.deepEqual(out, [{ role: "user", content: "hello" }]);
});

test("applyToolCacheMarkers: marks only the last tool definition", () => {
  const out = applyToolCacheMarkers([
    { name: "searchEditorialCorpus", schema: 1 },
    { name: "bookMeeting", schema: 2 },
  ]);
  assert.ok(out);
  assert.equal(out.length, 2);
  assert.equal(out[0].cache_control, undefined);
  assert.deepEqual(out[1].cache_control, { type: "ephemeral" });
});

test("applyToolCacheMarkers: returns undefined for empty list", () => {
  assert.equal(applyToolCacheMarkers([]), undefined);
});

test("cold-cache run: message_start usage is captured with cache_creation_input_tokens", () => {
  // Cold run — Anthropic returns cache_creation_input_tokens (the cost
  // surcharge for writing the cache) and cache_read_input_tokens=0.
  let usage = emptyCacheUsage();
  usage = mergeMessageStartUsage(usage, {
    input_tokens: 25,
    output_tokens: 1,
    cache_creation_input_tokens: 10_000,
    cache_read_input_tokens: 0,
  });
  usage = mergeMessageDeltaUsage(usage, { output_tokens: 320 });
  assert.equal(usage.inputTokens, 25);
  assert.equal(usage.outputTokens, 320);
  assert.equal(usage.cacheCreationInputTokens, 10_000);
  assert.equal(usage.cacheReadInputTokens, 0);
  assert.equal(cacheHitRate(usage), 0);
});

test("warm-cache run: cache_read_input_tokens dominates and hit rate is high", () => {
  // Warm run inside the 5-minute TTL window — the entire grounding corpus +
  // prior conversation is read from cache, only the new user message is
  // billed as fresh input.
  let usage = emptyCacheUsage();
  usage = mergeMessageStartUsage(usage, {
    input_tokens: 25,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 10_000,
  });
  usage = mergeMessageDeltaUsage(usage, { output_tokens: 320 });
  assert.equal(usage.cacheCreationInputTokens, 0);
  assert.equal(usage.cacheReadInputTokens, 10_000);
  // 10000 / (25 + 0 + 10000) ≈ 0.9975
  const rate = cacheHitRate(usage);
  assert.ok(rate > 0.99 && rate <= 1, `expected >0.99, got ${rate}`);
});

test("missing cache fields (older SDK shape) leave accumulator at zero", () => {
  // If the SDK ever returns a usage payload without the cache fields the
  // accumulator must NOT crash and must NOT silently leak prior values.
  let usage = emptyCacheUsage();
  usage = mergeMessageStartUsage(usage, {
    input_tokens: 12,
    output_tokens: 1,
    // cache_creation_input_tokens / cache_read_input_tokens omitted
  });
  assert.equal(usage.cacheCreationInputTokens, 0);
  assert.equal(usage.cacheReadInputTokens, 0);
  assert.equal(cacheHitRate(usage), 0);
});

test("null cache fields (Anthropic 'no-cache-on-this-call' signal) coerce to zero", () => {
  let usage = emptyCacheUsage();
  usage = mergeMessageStartUsage(usage, {
    input_tokens: 12,
    output_tokens: 1,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
  });
  assert.equal(usage.cacheCreationInputTokens, 0);
  assert.equal(usage.cacheReadInputTokens, 0);
});
