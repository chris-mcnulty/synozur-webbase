import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";

const execute = promisify(execFile);
export class PublicationError extends Error {}

// Validate every MPEG-1 Layer III frame, not just an average bitrate in metadata.
export function inspectPublicationMp3(audio: Buffer) {
  let offset = 0, frames = 0;
  if (audio.subarray(0, 3).toString() === "ID3") {
    if (audio.length < 10 || [...audio.subarray(6, 10)].some(v => v > 127)) throw new PublicationError("Invalid MP3 header.");
    offset = 10 + ((audio[6]! << 21) | (audio[7]! << 14) | (audio[8]! << 7) | audio[9]!);
    if (audio[5]! & 0x10) offset += 10;
  }
  while (offset < audio.length) {
    if (audio.length - offset === 128 && audio.subarray(offset, offset + 3).toString() === "TAG") break;
    const a = audio[offset], b = audio[offset + 1], c = audio[offset + 2], d = audio[offset + 3];
    // MPEG-1, layer III, 192 kbps, 44.1 kHz, mono.
    if (a !== 255 || b === undefined || (b & 0xfe) !== 0xfa || c === undefined ||
        (c >> 4) !== 11 || ((c >> 2) & 3) !== 0 || d === undefined || (d >> 6) !== 3) {
      throw new PublicationError("The encoded file failed the 192 kbps CBR / 44.1 kHz mono check.");
    }
    const length = Math.floor(144 * 192000 / 44100) + ((c >> 1) & 1);
    if (offset + length > audio.length) throw new PublicationError("The encoded MP3 is truncated.");
    offset += length;
    frames++;
  }
  if (frames < 2) throw new PublicationError("The encoded MP3 is empty.");
  return { sampleRate: 44100, bitrateKbps: 192, channels: 1 };
}

async function run(args: string[], cwd: string) {
  if (!ffmpeg) throw new PublicationError("The audio encoder is unavailable.");
  try {
    return await execute(ffmpeg, ["-hide_banner", "-nostdin", ...args], {
      cwd, timeout: 300_000, maxBuffer: 256 * 1024,
    });
  } catch {
    // Never expose encoder stderr (which can contain paths or document metadata).
    throw new PublicationError("Audio processing failed or timed out. Your original recording is unchanged.");
  }
}

async function measure(filename: string, cwd: string) {
  const { stderr, stdout } = await run([
    "-v", "info", "-xerror", "-i", filename, "-map", "0:a:0", "-af", "volumedetect",
    "-progress", "pipe:1", "-nostats", "-f", "null", "-",
  ], cwd);
  const mean = /mean_volume:\s*([-\d.]+) dB/.exec(stderr);
  const peak = /max_volume:\s*([-\d.]+) dB/.exec(stderr);
  const duration = [...stdout.matchAll(/out_time_us=(\d+)/g)].at(-1);
  if (!mean || !peak || !duration) throw new PublicationError("Audio measurements were unavailable.");
  return { rmsDb: Number(mean[1]), peakDb: Number(peak[1]), durationSeconds: Number(duration[1]) / 1e6 };
}

export async function masterPublication(source: Buffer) {
  const cwd = await mkdtemp(join(tmpdir(), "synozur-publication-"));
  try {
    await writeFile(join(cwd, "source.mp3"), source);
    const original = await measure("source.mp3", cwd);
    if (original.durationSeconds <= 0 || original.durationSeconds > 7200 || original.rmsDb < -70) {
      throw new PublicationError("The recording is silent, empty, or longer than the 120-minute publication limit.");
    }
    let gain = -20.5 - original.rmsDb;
    for (let pass = 0; pass < 4; pass++) {
      await run([
        "-v", "error", "-xerror", "-i", "source.mp3", "-map", "0:a:0",
        "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", "44100",
        // A peak limiter is not a LUFS normalizer: measure the finished MP3's RMS below.
        "-af", `volume=${gain.toFixed(3)}dB,alimiter=limit=0.562341:level=false`,
        "-c:a", "libmp3lame", "-b:a", "192k", "-y", "publication.mp3",
      ], cwd);
      const report = await measure("publication.mp3", cwd);
      if (report.durationSeconds > 7200 || Math.abs(report.durationSeconds - original.durationSeconds) > 0.25) {
        throw new PublicationError("The exported recording failed the duration check. The original is unchanged.");
      }
      const audio = await readFile(join(cwd, "publication.mp3"));
      const encoding = inspectPublicationMp3(audio);
      if (report.rmsDb >= -23 && report.rmsDb <= -18 && report.peakDb <= -3) {
        return { audio, report: { ...report, ...encoding } };
      }
      gain += -20.5 - report.rmsDb;
    }
    throw new PublicationError("This recording could not meet RMS and peak limits safely. It needs an audio engineer's review; the original is unchanged.");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
