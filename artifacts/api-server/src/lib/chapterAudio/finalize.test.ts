import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeChapter, type ChapterFinalization } from "./finalize";
import { ChapterLeaseLost, ChapterProcessingError, classifyChapterFailure, type ChapterFailure } from "./diagnostics";
import { SpeGraphRequestError } from "../storage/spe/graphClient";

function harness(overrides: Partial<ChapterFinalization> = {}) {
  const failures: ChapterFailure[] = [];
  const counts = { assemble: 0, save: 0, complete: 0, wait: 0 };
  const result = { audio: Buffer.from("synthetic-audio"), duration: 1 };
  const io: ChapterFinalization = {
    assemble: async () => { counts.assemble++; return result; },
    save: async () => { counts.save++; },
    complete: async () => { counts.complete++; },
    owned: async () => true, stage: async () => {},
    failure: async event => { failures.push(event); },
    success: () => {}, wait: async () => { counts.wait++; },
    ...overrides,
  };
  return { io, failures, counts, result };
}
const sections = [Buffer.from("saved-section")];

test("normal finalization assembles, saves and completes once", async () => {
  const h = harness();
  assert.equal(await finalizeChapter(sections, h.io), h.result);
  assert.deepEqual(h.counts, { assemble: 1, save: 1, complete: 1, wait: 0 });
  assert.deepEqual(h.failures, []);
});

test("an encoder timeout retries assembly once using the saved sections", async () => {
  const h = harness();
  h.io.assemble = async buffers => {
    assert.equal(buffers, sections);
    if (++h.counts.assemble === 1) throw new ChapterProcessingError("encoder_timeout", true);
    return h.result;
  };
  await finalizeChapter(sections, h.io);
  assert.deepEqual(h.counts, { assemble: 2, save: 1, complete: 1, wait: 1 });
  assert.equal(h.failures[0].stage, "assembly");
  assert.equal(h.failures[0].code, "encoder_timeout");
  assert.equal(h.failures[0].willRetry, true);
});

test("transient SharePoint failure retries only saving, never assembly or synthesis", async () => {
  const h = harness();
  h.io.save = async result => {
    assert.equal(result, h.result);
    if (++h.counts.save === 1) throw new SpeGraphRequestError("do-not-log-provider-body", 503, "do-not-log-provider-body");
  };
  await finalizeChapter(sections, h.io);
  assert.deepEqual(h.counts, { assemble: 1, save: 2, complete: 1, wait: 1 });
  assert.equal(h.failures[0].stage, "final_save");
  assert.equal(h.failures[0].code, "storage_http_503");
  assert.ok(!JSON.stringify(h.failures).includes("do-not-log-provider-body"));
});

test("completion database interruption retries metadata only", async () => {
  const h = harness();
  h.io.complete = async () => {
    if (++h.counts.complete === 1) throw Object.assign(new Error("private-error-text"), { code: "40001" });
  };
  await finalizeChapter(sections, h.io);
  assert.deepEqual(h.counts, { assemble: 1, save: 1, complete: 2, wait: 1 });
  assert.equal(h.failures[0].stage, "complete");
  assert.equal(h.failures[0].code, "database_temporarily_unavailable");
});

test("persistent transient failure stops after two attempts and retains both diagnostics", async () => {
  const h = harness();
  h.io.assemble = async () => { h.counts.assemble++; throw new ChapterProcessingError("encoder_timeout", true); };
  await assert.rejects(finalizeChapter(sections, h.io), /encoder_timeout/);
  assert.deepEqual(h.counts, { assemble: 2, save: 0, complete: 0, wait: 1 });
  assert.deepEqual(h.failures.map(entry => [entry.attempt, entry.willRetry]), [[1, true], [2, false]]);
});

test("permanent encoder or authorization failures do not retry", async () => {
  for (const error of [new ChapterProcessingError("encoder_unavailable", false), new SpeGraphRequestError("private", 403, "private")]) {
    const h = harness({ assemble: async () => { throw error; } });
    await assert.rejects(finalizeChapter(sections, h.io));
    assert.equal(h.failures.length, 1);
    assert.equal(h.failures[0].willRetry, false);
    assert.equal(h.counts.wait, 0);
  }
});

test("cancellation or loss of lease during backoff prevents further work", async () => {
  let owned = true;
  const h = harness();
  h.io.owned = async () => owned;
  h.io.assemble = async () => { h.counts.assemble++; throw new ChapterProcessingError("encoder_timeout", true); };
  h.io.wait = async () => { owned = false; };
  await assert.rejects(finalizeChapter(sections, h.io), ChapterLeaseLost);
  assert.equal(h.counts.assemble, 1);
  assert.equal(h.counts.save, 0);
  assert.equal(h.counts.complete, 0);
});

test("loss of ownership before saving cannot publish assembled bytes", async () => {
  const h = harness();
  let checks = 0;
  h.io.owned = async () => ++checks < 2;
  await assert.rejects(finalizeChapter(sections, h.io), ChapterLeaseLost);
  assert.equal(h.counts.assemble, 1);
  assert.equal(h.counts.save, 0);
});

test("diagnostic classification never includes arbitrary error messages or object fields", () => {
  const secret = "manuscript text, credentials, stderr and URLs";
  assert.deepEqual(classifyChapterFailure(new Error(secret)), { code: "unexpected_failure", retryable: false });
  assert.deepEqual(classifyChapterFailure({ message: secret, code: secret, cause: { code: secret } }),
    { code: "unexpected_failure", retryable: false });
  assert.deepEqual(classifyChapterFailure(Object.assign(new TypeError(secret), { cause: { code: "ECONNRESET" } })),
    { code: "network_interrupted", retryable: true });
});
