// Keep browser media requests bounded, including Chromium's initial bytes=0-.
// A 206 may return a smaller contiguous range than the one requested.
export const CHAPTER_AUDIO_RANGE_BYTES = 1024 * 1024;

export function chapterAudioRange(header: string | undefined, size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? `bytes=0-`);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1, start + CHAPTER_AUDIO_RANGE_BYTES - 1) };
}
