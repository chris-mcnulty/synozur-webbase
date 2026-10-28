import test from "node:test";
import assert from "node:assert/strict";
import { chapterStatusText } from "./chapter-audio-status";

test("chapter status distinguishes queue, progress, readiness and failures", () => {
  assert.match(chapterStatusText({ status: "queued", completedChunks: 0, totalChunks: 5 }), /In queue/);
  assert.match(chapterStatusText({ status: "processing", completedChunks: 2, totalChunks: 5 }), /2 of 5/);
  assert.match(chapterStatusText({ status: "completed", completedChunks: 5, totalChunks: 5 }), /downloaded/);
  assert.match(chapterStatusText({ status: "failed", completedChunks: 2, totalChunks: 5 }), /Retry/);
});
