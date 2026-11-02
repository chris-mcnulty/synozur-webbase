import test from "node:test";
import assert from "node:assert/strict";
import { analyzePublicationEdges } from "./publicationChecks";

function pcm(parts: [seconds: number, db: number][]) {
  const buffers = parts.map(([seconds, db]) => {
    const result = Buffer.alloc(Math.round(seconds * 44100) * 4);
    for (let i = 0; i < result.length / 4; i++) {
      // Deterministic synthetic nonzero background; no manuscript or real audio.
      result.writeFloatLE(db === -Infinity ? 0 : (i % 2 ? -1 : 1) * 10 ** (db / 20), i * 4);
    }
    return result;
  });
  return Buffer.concat(buffers);
}

test("quiet-edge noise is estimated separately from narration, never an automatic pass", () => {
  const checks = analyzePublicationEdges(pcm([[2, -68], [3, -20]]), pcm([[3, -20], [2, -64]]));
  assert.equal(checks.leadingRoomTone.seconds, 2);
  assert.equal(checks.trailingRoomTone.seconds, 2);
  assert.equal(checks.noiseFloor.status, "review");
  assert.ok(Math.abs(checks.noiseFloor.rmsDb! + 64) < 0.01);
  assert.equal(checks.leadingRoomTone.status, "review");
  assert.equal(checks.trailingRoomTone.status, "review");
});

test("digital silence is not room tone or a passing noise floor", () => {
  const checks = analyzePublicationEdges(pcm([[2, -Infinity], [3, -20]]), pcm([[3, -20], [2, -Infinity]]));
  assert.equal(checks.noiseFloor.rmsDb, null);
  assert.equal(checks.noiseFloor.status, "unmeasurable");
  assert.equal(checks.leadingRoomTone.status, "unmeasurable");
  assert.match(checks.trailingRoomTone.detail, /not verified room tone/);
});

test("flags noisy candidates, short edges, long spacing and unknown noise floor", () => {
  const checks = analyzePublicationEdges(pcm([[0.8, -50], [3, -20]]), pcm([[3, -20], [6, -65]]));
  assert.equal(checks.noiseFloor.status, "warning");
  assert.equal(checks.leadingRoomTone.status, "warning");
  assert.equal(checks.trailingRoomTone.status, "warning");
  const missing = analyzePublicationEdges(pcm([[3, -20]]), pcm([[3, -20]]));
  assert.equal(missing.noiseFloor.status, "unmeasurable");
  assert.equal(missing.leadingRoomTone.seconds, 0);
  assert.equal(missing.trailingRoomTone.seconds, 0);
});

test("ten-second scan without a speech boundary is a lower-bound warning", () => {
  const checks = analyzePublicationEdges(pcm([[10, -65]]), pcm([[10, -65]]));
  assert.equal(checks.leadingRoomTone.status, "warning");
  assert.match(checks.leadingRoomTone.detail, /At least 10.0/);
});

test("one silent edge cannot hide a noisy opposite edge", () => {
  const checks = analyzePublicationEdges(pcm([[2, -Infinity], [3, -20]]), pcm([[3, -20], [2, -52]]));
  assert.equal(checks.noiseFloor.status, "warning");
  assert.ok(Math.abs(checks.noiseFloor.rmsDb! + 52) < 0.01);
});
