// Microsoft documents HD PCM support and the REST 48 kHz RIFF format:
// https://learn.microsoft.com/azure/ai-services/speech-service/high-definition-voices
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
// Format versions are persisted per job: retries must never replace paid legacy
// sections just because the default for newly submitted chapters changed.
export const LOSSLESS_SOURCE = "pcm48-v1";
export const LEGACY_SOURCE = "mp3-24-v1";
export const PCM_OUTPUT = "riff-48khz-16bit-mono-pcm";
export const MP3_OUTPUT = "audio-24khz-96kbitrate-mono-mp3";

/** Reject unexpected provider output instead of labelling a lossy file PCM. */
export function isChapterPcm(bytes: Buffer): boolean {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE") return false;
  let validFormat = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) return false;
    if (name === "fmt ") {
      if (size < 16) return false;
      validFormat = bytes.readUInt16LE(start) === 1 &&
        bytes.readUInt16LE(start + 2) === 1 && bytes.readUInt32LE(start + 4) === 48000 &&
        bytes.readUInt16LE(start + 14) === 16;
    }
    if (name === "data") return validFormat && size > 0 && size % 2 === 0;
    offset = start + size + size % 2;
  }
  return false;
}

export function sectionKey(id: string, index: number, format: string) {
  if (format === LOSSLESS_SOURCE) return `jobs/${id}/section-pcm48-v1-${index}.wav`;
  if (format === LEGACY_SOURCE) return `jobs/${id}/section-${index}.mp3`;
  throw new Error("Unsupported chapter source format.");
}
