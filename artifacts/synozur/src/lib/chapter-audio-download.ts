// Fetch private chapters in bounded ranges, rather than one large proxy response.
export async function fetchChapterAudio(url: string, size: number, onProgress: (percent: number) => void) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("This chapter has no recorded audio size.");
  const parts: ArrayBuffer[] = [];
  let start = 0;
  while (start < size) {
    const requestedEnd = Math.min(start + 1024 * 1024 - 1, size - 1);
    const response = await fetch(url, {
      credentials: "include",
      headers: { Range: `bytes=${start}-${requestedEnd}` },
      cache: "no-store",
    });
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    if (response.status !== 206 || !match || Number(match[1]) !== start ||
        Number(match[2]) > requestedEnd || Number(match[2]) < start || Number(match[3]) !== size) {
      await response.body?.cancel();
      throw new Error("Audio delivery failed. Your generated chapter is saved; try Download again. Do not regenerate it.");
    }
    const part = await response.arrayBuffer();
    if (part.byteLength !== Number(match[2]) - start + 1) throw new Error("The audio transfer was interrupted. Please try Download again.");
    parts.push(part);
    start += part.byteLength;
    onProgress(Math.round(start / size * 100));
  }
  return new Blob(parts, { type: "audio/mpeg" });
}
