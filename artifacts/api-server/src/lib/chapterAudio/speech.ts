import { createHash } from "node:crypto";
import { buildSsml, isAzureTtsConfigured, VALID_AZURE_VOICES } from "../azureTts";
import { chapterFileExists, readChapterFile, saveChapterFile } from "./store";
import { STANDARD_SAMPLE } from "./text";

export const CHAPTER_VOICES = VALID_AZURE_VOICES.filter(v => v.includes(":DragonHD"));
export { isAzureTtsConfigured };
export class ChapterSpeechError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export async function renderChapterSection(text: string, voice: string): Promise<Buffer> {
  if (!(CHAPTER_VOICES as readonly string[]).includes(voice)) throw new Error("Choose a supported Dragon HD voice.");
  if (!isAzureTtsConfigured()) throw new Error("Azure Speech is not configured.");
  const region = process.env.AZURE_SPEECH_REGION?.trim();
  if (!region || !/^[a-z0-9-]+$/.test(region)) throw new Error("Azure Speech region is invalid.");
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "synozur-chapter-audio",
    },
    body: buildSsml(text, voice),
  });
  // Do not persist Azure bodies: these can echo manuscript content.
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new ChapterSpeechError("Azure Speech rejected its credentials. Ask an administrator to check the speech connection.", false);
    if (response.status === 400 || response.status === 404) throw new ChapterSpeechError("Azure could not use this voice or text in the configured region. Choose another Dragon HD voice or ask an administrator to check availability.", false);
    throw new ChapterSpeechError(`Azure Speech is temporarily unavailable (HTTP ${response.status}). Retry this chapter later.`, response.status === 429 || response.status >= 500);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100) throw new ChapterSpeechError("Azure returned incomplete audio. Retry this chapter.", true);
  return bytes;
}

const sampleRequests = new Map<string, Promise<Buffer>>();
export async function getChapterSample(voice: string): Promise<Buffer> {
  if (!(CHAPTER_VOICES as readonly string[]).includes(voice)) throw new Error("Choose a supported Dragon HD voice.");
  const existing = sampleRequests.get(voice);
  if (existing) return existing;
  const request = (async () => {
    const hash = createHash("sha256").update(`sample-1|${voice}|${STANDARD_SAMPLE}`).digest("hex");
    const key = `samples/${hash}.mp3`;
    if (await chapterFileExists(key)) return readChapterFile(key);
    const bytes = await renderChapterSection(STANDARD_SAMPLE, voice);
    await saveChapterFile(key, bytes, "audio/mpeg");
    return bytes;
  })();
  sampleRequests.set(voice, request);
  try { return await request; } finally { sampleRequests.delete(voice); }
}
