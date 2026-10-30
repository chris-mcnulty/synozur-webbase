import test from "node:test";
import assert from "node:assert/strict";
import { fetchChapterAudio } from "./chapter-audio-download";

test("download verifies ranges and assembles the complete file without a large response", async () => {
  const original = globalThis.fetch;
  const bytes = new Uint8Array(2 * 1024 * 1024 + 17).fill(123);
  const ranges: string[] = [];
  const progress: number[] = [];
  try {
    globalThis.fetch = async (_url, options) => {
      const range = (options?.headers as Record<string, string>).Range!;
      ranges.push(range);
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const start = Number(first), end = Number(last);
      assert.equal(options?.credentials, "include");
      return new Response(bytes.slice(start, end + 1), {
        status: 206, headers: { "content-range": `bytes ${start}-${end}/${bytes.length}` },
      });
    };
    const blob = await fetchChapterAudio("/private/audio", bytes.length, p => progress.push(p));
    assert.equal(ranges.length, 3);
    assert.equal(blob.type, "audio/mpeg");
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    assert.equal(progress.at(-1), 100);
  } finally { globalThis.fetch = original; }
});

test("download rejects HTML/auth responses, mismatched ranges and truncated transfers", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      new Response("Sign in", { status: 200 }),
      new Response("Unavailable", { status: 503 }),
      new Response(new Uint8Array(10), { status: 206, headers: { "content-range": "bytes 1-10/10" } }),
      new Response(new Uint8Array(1), { status: 206, headers: { "content-range": "bytes 0-9/10" } }),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(fetchChapterAudio("/private/audio", 10, () => {}));
    }
  } finally { globalThis.fetch = original; }
});
