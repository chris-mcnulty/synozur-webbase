import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { existsSync } from "node:fs";

export function chapterEncoderReady() { return !!ffmpeg && existsSync(ffmpeg); }

export async function assembleChapter(sections: Buffer[]): Promise<{ audio: Buffer; duration: number }> {
  if (!chapterEncoderReady()) throw new Error("The chapter MP3 encoder is not installed.");
  const directory = await mkdtemp(join(tmpdir(), "synozur-chapter-"));
  try {
    for (let i = 0; i < sections.length; i++) await writeFile(join(directory, `${i}.mp3`), sections[i]!);
    await writeFile(join(directory, "inputs.txt"), sections.map((_, i) => `file '${i}.mp3'`).join("\n"));
    let duration = 0;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg!, [
        "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "1", "-i", "inputs.txt",
        "-map_metadata", "-1", "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "96k",
        "-progress", "pipe:1", "-nostats", "-y", "audio.mp3",
      ], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Audio assembly timed out. Retry the chapter.")); }, 300_000);
      child.stdout.on("data", (data: Buffer) => {
        output = (output + data.toString()).slice(-16000);
        const values = [...output.matchAll(/out_time_us=(\d+)/g)];
        const last = values.at(-1);
        if (last) duration = Number(last[1]) / 1_000_000;
      });
      // Consume stderr without logging filenames or content.
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timeout); reject(new Error("The MP3 encoder could not start.")); });
      child.on("close", code => {
        clearTimeout(timeout);
        if (code !== 0 || duration <= 0) reject(new Error("Audio validation failed during MP3 assembly. Retry the chapter."));
        else resolve();
      });
    });
    const audio = await readFile(join(directory, "audio.mp3"));
    if (audio.length < 100) throw new Error("The assembled chapter audio is empty.");
    return { audio, duration };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
