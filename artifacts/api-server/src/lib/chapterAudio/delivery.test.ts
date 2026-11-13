import test from "node:test";
import assert from "node:assert/strict";
import { chapterAudioRange, CHAPTER_AUDIO_RANGE_BYTES as limit } from "./delivery";

test("browser initial open-ended range is bounded, not the entire chapter", () => {
  assert.deepEqual(chapterAudioRange("bytes=0-", 40_000_000), { start: 0, end: limit - 1 });
});
test("seeking, suffix ranges and overlarge end offsets are supported", () => {
  assert.deepEqual(chapterAudioRange("bytes=2000000-", 40_000_000), { start: 2_000_000, end: 2_000_000 + limit - 1 });
  assert.deepEqual(chapterAudioRange("bytes=-128", 1000), { start: 872, end: 999 });
  assert.deepEqual(chapterAudioRange("bytes=900-9999999", 1000), { start: 900, end: 999 });
  assert.deepEqual(chapterAudioRange("bytes=0-1", 1000), { start: 0, end: 1 });
});
test("invalid, multipart, empty, unsatisfiable and unsafe ranges are rejected", () => {
  for (const range of ["bytes=-", "bytes=-0", "bytes=1000-", "bytes=2-1", "bytes=0-1,3-4", "bytes=99999999999999999999-"]) {
    assert.equal(chapterAudioRange(range, 1000), null);
  }
  assert.equal(chapterAudioRange("bytes=0-", 0), null);
});
