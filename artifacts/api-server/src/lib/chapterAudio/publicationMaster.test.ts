import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { masterPublication, inspectPublicationMp3 } from "./publicationMaster";

async function source(filter: string, seconds = "3") {
  const { stdout } = await promisify(execFile)(ffmpeg!, [
    "-hide_banner", "-v", "error", "-f", "lavfi", "-i", filter, "-t", seconds,
    "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1",
  ], { encoding: "buffer", timeout: 10000 });
  return stdout;
}

test("masters a low-RMS 24kHz/96kbps source and measures the actual finished MP3", async () => {
  const input = await source("sine=frequency=440:sample_rate=24000,volume=0.5");
  const original = Buffer.from(input);
  const { audio, report } = await masterPublication(input);
  assert.deepEqual(input, original);
  assert.equal(report.sampleRate, 44100);
  assert.equal(report.bitrateKbps, 192);
  assert.equal(report.channels, 1);
  assert.ok(report.rmsDb >= -23 && report.rmsDb <= -18);
  assert.ok(report.peakDb <= -3);
  assert.ok(report.durationSeconds >= 3 && report.durationSeconds < 3.2);
  assert.ok(audio.length > input.length * 1.7);
  assert.throws(() => inspectPublicationMp3(input), /192 kbps/);
  assert.throws(() => inspectPublicationMp3(audio.subarray(0, audio.length - 50)), /truncated/);
});

test("limits peaks while bringing a higher-crest-factor recording into RMS range", async () => {
  const input = await source("aevalsrc=0.035*sin(2*PI*220*t)+if(lt(mod(t\\,0.5)\\,0.008)\\,0.7*sin(2*PI*880*t)\\,0):s=24000");
  const { report } = await masterPublication(input);
  assert.ok(report.rmsDb >= -23 && report.rmsDb <= -18);
  assert.ok(report.peakDb <= -3);
});

test("fails safely on silence or corrupt source, rather than offering a misleading export", async () => {
  await assert.rejects(masterPublication(await source("anullsrc=r=24000:cl=mono")), /silent/);
  await assert.rejects(masterPublication(Buffer.from("not audio")), /processing failed/);
});
