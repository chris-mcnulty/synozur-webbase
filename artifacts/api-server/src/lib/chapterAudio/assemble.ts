import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { existsSync } from "node:fs";
import { ChapterProcessingError } from "./diagnostics";

export function chapterEncoderReady() { return !!ffmpeg && existsSync(ffmpeg); }

export async function assembleChapter(sections: Buffer[], lossless = false): Promise<{ audio: Buffer; duration: number; source?: Buffer }> {
  if (!chapterEncoderReady()) throw new ChapterProcessingError("encoder_unavailable", false);
  const directory = await mkdtemp(join(tmpdir(), "synozur-chapter-"));
  try {
    const extension = lossless ? "wav" : "mp3";
    for (let i = 0; i < sections.length; i++) await writeFile(join(directory, `${i}.${extension}`), sections[i]!);
    await writeFile(join(directory, "inputs.txt"), sections.map((_, i) => `file '${i}.${extension}'`).join("\n"));
    let duration = 0;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg!, [
        "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "1", "-i", "inputs.txt",
        ...(lossless ? ["-map_metadata", "-1", "-ac", "1", "-ar", "48000", "-c:a", "flac", "-sample_fmt", "s16", "-y", "source.flac"] : []),
        "-map_metadata", "-1", "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "96k",
        "-progress", "pipe:1", "-nostats", "-y", "audio.mp3",
      ], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new ChapterProcessingError("encoder_timeout", true)); }, 300_000);
      child.stdout.on("data", (data: Buffer) => {
        output = (output + data.toString()).slice(-16000);
        const values = [...output.matchAll(/out_time_us=(\d+)/g)];
        const last = values.at(-1);
        if (last) duration = Number(last[1]) / 1_000_000;
      });
      // Consume stderr without logging filenames or content.
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timeout); reject(new ChapterProcessingError("encoder_start_failed", false)); });
      child.on("close", code => {
        clearTimeout(timeout);
        if (code !== 0) reject(new ChapterProcessingError("encoder_exit_failed", false));
        else if (duration <= 0) reject(new ChapterProcessingError("encoder_invalid_output", false));
        else resolve();
      });
    });
    const audio = await readFile(join(directory, "audio.mp3"));
    if (audio.length < 100) throw new ChapterProcessingError("encoder_invalid_output", false);
    const source = lossless ? await readFile(join(directory, "source.flac")) : undefined;
    if (source && source.length < 100) throw new ChapterProcessingError("encoder_invalid_output", false);
    return { audio, duration, source };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
