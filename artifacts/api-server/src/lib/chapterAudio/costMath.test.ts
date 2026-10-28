import test from "node:test";
import assert from "node:assert/strict";
import { billableCharacters, estimateSpeech, makeNarration, summarizeUsage, type UsageRow } from "./costMath";

const voice = "en-US-Ava:DragonHDLatestNeural";
test("speech counting includes Unicode, whitespace, escaped XML, pronunciation markup and CJK weighting", () => {
  assert.equal(billableCharacters("Hello, world!", voice), 13);
  assert.equal(billableCharacters("A 😀 中", voice), 6);
  assert.equal(billableCharacters("A & B", voice), 9); // A &amp; B
  assert.ok(billableCharacters("Synozur", voice) > 7);
  assert.equal(billableCharacters("one\n two", voice), 8);
});
test("estimates use the same narration and section boundaries as synthesis, and missing price is not zero", () => {
  const text = makeNarration("  Hello. ", " A note. ", true);
  assert.equal(text, "Hello.\n\nChapter notes.\n\nA note.");
  assert.equal(estimateSpeech(text, voice, null).estimatedCost, null);
  const rate = { id: "test", perMillion: 10, currency: "USD", effectiveFrom: "2026-01-01", savedAt: "2026-01-01" };
  const estimated = estimateSpeech(text, voice, rate);
  assert.equal(estimated.estimatedCost, estimated.billableCharacters * 10 / 1e6);
  assert.equal(estimateSpeech(text, voice, { ...rate, perMillion: 0 }).estimatedCost, 0);
  assert.equal(makeNarration("Hello.", "Secret omitted footnote", false), "Hello.");
});
const usage = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  id: "test", job_id: "chapter", kind: "chapter", actor_id: "editor", actor_label: "Editor",
  voice, section_index: 0, characters: 1000, outcome: "succeeded", is_retry: false,
  rate_per_million: "10", currency: "USD", ...overrides,
});
test("usage keeps rate snapshots, uncertainty, retries, samples, unpriced work and currencies separate", () => {
  const result = summarizeUsage([
    usage(),
    usage({ outcome: "uncertain", is_retry: true, rate_per_million: "20" }),
    usage({ outcome: "started", currency: "CAD" }),
    usage({ outcome: "rejected" }),
    usage({ rate_per_million: null, currency: null }),
    usage({ job_id: null, kind: "sample" }),
    usage({ kind: "reuse", characters: 0, rate_per_million: null, currency: null }),
  ]);
  assert.equal(result.attempts, 6);
  assert.equal(result.submittedCharacters, 6000);
  assert.equal(result.successfulCharacters, 3000);
  assert.equal(result.uncertainCharacters, 2000);
  assert.equal(result.rejectedCharacters, 1000);
  assert.equal(result.unpricedCharacters, 1000);
  assert.equal(result.retryCharacters, 1000);
  assert.equal(result.sampleAttempts, 1);
  assert.equal(result.reusedSections, 1);
  assert.equal(result.chapterCount, 1);
  const usd = result.costs.find(c => c.currency === "USD")!;
  assert.equal(usd.amount, 0.04);
  assert.equal(usd.uncertainAmount, 0.02);
  assert.equal(usd.retryAmount, 0.02);
  assert.equal(usd.sampleAmount, 0.01);
  assert.equal(result.costs.find(c => c.currency === "CAD")!.amount, 0.01);
});
