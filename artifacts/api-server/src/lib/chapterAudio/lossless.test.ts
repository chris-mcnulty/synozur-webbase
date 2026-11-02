import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { assembleChapter } from "./assemble";
import { masterPublication } from "./publicationMaster";
import { sectionKey, LOSSLESS_SOURCE, LEGACY_SOURCE, isChapterPcm } from "./formats";
import { finalizeChapter } from "./finalize";
import { SpeGraphRequestError } from "../storage/spe/graphClient";

async function encode(args: string[], input?: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(ffmpeg!, ["-v", "error", ...args],
      { encoding: "buffer", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => error ? reject(new Error("Synthetic encoder failed")) : resolve(stdout));
    child.stdin!.end(input);
  });
}

// Decode in the test using the same installed binary, without paid speech or
// manuscript fixtures. PCM equality proves no lossy encoding before mastering.
test("48kHz PCM sections preserve every sample in the assembled FLAC source", async () => {
  const { stdout: wav } = await promisify(execFile)(ffmpeg!, [
    "-v", "error", "-f", "lavfi", "-i", "sine=frequency=16000:sample_rate=48000",
    "-t", "0.5", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1",
  ], { encoding: "buffer", timeout: 10_000 });
  const result = await assembleChapter([wav, wav], true);
  assert.ok(result.source);
  assert.equal(result.source.subarray(0, 4).toString(), "fLaC");
  const decoded = await encode(["-i", "pipe:0", "-f", "s16le", "pipe:1"], result.source);
  const section = await encode(["-i", "pipe:0", "-f", "s16le", "pipe:1"], wav);
  assert.deepEqual(decoded, Buffer.concat([section, section]));
  assert.equal(decoded.length, 48000 * 2); // one second, mono, 16 bit
  assert.ok(result.duration >= 1 && result.duration < 1.2);
});

test("publication mastering accepts a lossless source and still meets export checks", async () => {
  const { stdout: wav } = await promisify(execFile)(ffmpeg!, [
    "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "1", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1",
  ], { encoding: "buffer", timeout: 10_000 });
  const result = await assembleChapter([wav], true);
  const { report } = await masterPublication(result.source!);
  assert.equal(report.sampleRate, 44100);
  assert.equal(report.bitrateKbps, 192);
  assert.ok(report.rmsDb >= -23 && report.rmsDb <= -18);
  assert.ok(report.peakDb <= -3);
});

test("format-versioned section caches preserve legacy keys without cross-format reuse", () => {
  assert.equal(sectionKey("id", 2, LEGACY_SOURCE), "jobs/id/section-2.mp3");
  assert.equal(sectionKey("id", 2, LOSSLESS_SOURCE), "jobs/id/section-pcm48-v1-2.wav");
  assert.throws(() => sectionKey("id", 2, "unknown"));
});

test("only complete 48kHz 16-bit mono RIFF PCM qualifies as the lossless synthesis source", () => {
  const wav = Buffer.alloc(160);
  wav.write("RIFF", 0); wav.writeUInt32LE(152, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(116, 40);
  assert.equal(isChapterPcm(wav), true);
  assert.equal(isChapterPcm(wav.subarray(0, 100)), false);
  assert.equal(isChapterPcm(Buffer.from("ID3 lossy output")), false);
  for (const [offset, value] of [[20, 3], [22, 2], [34, 24]]) {
    const invalid = Buffer.from(wav);
    invalid.writeUInt16LE(value!, offset!);
    assert.equal(isChapterPcm(invalid), false);
  }
  wav.writeUInt32LE(24000, 24);
  assert.equal(isChapterPcm(wav), false);
});

test("lossless final-save recovery retains the same source and never repeats assembly", async () => {
  const result = { audio: Buffer.from("mp3"), source: Buffer.from("flac"), duration: 1 };
  let assemblies = 0, saves = 0, completions = 0;
  await finalizeChapter([], {
    assemble: async () => { assemblies++; return result; },
    save: async saved => {
      assert.equal(saved.source, result.source);
      if (++saves === 1) throw new SpeGraphRequestError("Temporary storage failure", 503, "");
    },
    complete: async () => { completions++; },
    owned: async () => true, stage: async () => {}, failure: async () => {}, success: () => {}, wait: async () => {},
  });
  assert.equal(assemblies, 1);
  assert.equal(saves, 2);
  assert.equal(completions, 1);
});
