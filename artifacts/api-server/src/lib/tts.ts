import { logger } from "./logger";

// Text-to-speech for the Briefing Podcast feature.
//
// Two stages:
//   1. `briefingHtmlToScript()` turns the briefing email's HTML body into a
//      clean, spoken-word script using Claude. Format (single vs dialogue) and
//      tone are driven by PodcastConfig.
//   2. `synthesizeSpeech()` calls OpenAI's TTS endpoint and returns an MP3
//      Buffer. For single-narrator format a single voice is used throughout.
//      For dialogue format the script is parsed into HOST / CO-HOST turns and
//      each turn is synthesised with the matching voice, then concatenated in
//      order. MP3 frames are independently decodable so naive concatenation
//      plays back correctly.

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
// tts-1 is faster and has better availability than tts-1-hd; quality is
// sufficient for a spoken briefing. Override with OPENAI_TTS_MODEL if needed.
const TTS_MODEL = process.env["OPENAI_TTS_MODEL"] ?? "tts-1";
// Legacy env-var override still honoured as the default single voice.
const DEFAULT_VOICE = process.env["OPENAI_TTS_VOICE"] ?? "onyx";
// Leave headroom under the 4096-char hard cap.
const TTS_CHUNK_LIMIT = 3500;
// ~150 spoken words/min ≈ ~900 chars/min → rough duration estimate.
const CHARS_PER_SECOND = 15;

const SCRIPT_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const OPENAI_TTS_VOICES = [
  "alloy", "ash", "coral", "echo", "fable",
  "nova", "onyx", "sage", "shimmer",
] as const;
export type OpenAiVoice = (typeof OPENAI_TTS_VOICES)[number];

export type PodcastFormat = "single" | "dialogue";
export type PodcastTone   = "formal" | "conversational" | "energetic";

export interface PodcastConfig {
  /** "single" — one narrator; "dialogue" — two-speaker HOST / CO-HOST exchange. */
  format: PodcastFormat;
  /** Overall delivery style applied to the Claude system prompt. */
  tone: PodcastTone;
  /** OpenAI voice used for the single-narrator format. */
  voice: string;
  /** HOST voice used in dialogue format. */
  hostVoice: string;
  /** CO-HOST voice used in dialogue format. */
  cohostVoice: string;
}

export const DEFAULT_PODCAST_CONFIG: PodcastConfig = {
  format: "single",
  tone: "conversational",
  voice: DEFAULT_VOICE,
  hostVoice: DEFAULT_VOICE,
  cohostVoice: "nova",
};

export class TtsNotConfiguredError extends Error {
  constructor() {
    super("OpenAI TTS not configured — set OPENAI_API_KEY.");
    this.name = "TtsNotConfiguredError";
    Object.setPrototypeOf(this, TtsNotConfiguredError.prototype);
  }
}

export interface SynthesisResult {
  audio: Buffer;
  estimatedDurationSeconds: number;
}

// ---------------------------------------------------------------------------
// HTML → plain text
// ---------------------------------------------------------------------------

export function stripBriefingHtml(html: string): string {
  let text = html;
  text = text.replace(/<head[\s\S]*?<\/head>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<\/(h1|h2|h3|h4|p|li|tr|div)>/gi, "\n");
  text = text.replace(/<br\s*\/?>(?=)/gi, "\n");
  text = text.replace(/<\/td>/gi, ": ");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&middot;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'");
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return text.trim();
}

// ---------------------------------------------------------------------------
// Claude script generation
// ---------------------------------------------------------------------------

const TONE_PHRASE: Record<PodcastTone, string> = {
  formal:         "professional, precise, and concise",
  conversational: "natural, warm, and approachable",
  energetic:      "upbeat, punchy, and engaging",
};

function buildSystemPrompt(config: PodcastConfig): string {
  const tone = TONE_PHRASE[config.tone] ?? TONE_PHRASE.conversational;

  if (config.format === "dialogue") {
    return (
      `You convert a written executive morning briefing into a ${tone} ` +
      `two-person podcast dialogue. ` +
      `Use exactly two speakers labelled [HOST] and [CO-HOST]. ` +
      `Format every line as:\n[HOST]: <spoken line>\n[CO-HOST]: <spoken line>\n` +
      `The HOST introduces topics and drives the flow. The CO-HOST asks ` +
      `clarifying questions, adds commentary, and highlights key takeaways. ` +
      `Keep all facts, names, and numbers accurate — do not invent content. ` +
      `Open with a brief welcome exchange, cover each section with natural ` +
      `back-and-forth dialogue, and close with a short sign-off from both speakers. ` +
      `Output ONLY the labelled dialogue lines — no headings, no markdown, ` +
      `no stage directions, no blank lines between turns.`
    );
  }

  return (
    `You convert a written executive morning briefing into a ${tone} ` +
    `spoken-word narration script for a single narrator. ` +
    `Keep all the facts, names, and numbers. ` +
    `Open with a brief friendly intro, read each section with smooth ` +
    `transitions, and close with a short sign-off. ` +
    `Do not invent content. Output only the narration text — ` +
    `no headings, no markdown, no stage directions.`
  );
}

export async function briefingHtmlToScript(
  html: string,
  config: PodcastConfig = DEFAULT_PODCAST_CONFIG,
): Promise<string> {
  const stripped = stripBriefingHtml(html);
  if (!stripped) return "";
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const userPrompt =
      config.format === "dialogue"
        ? `Here is today's briefing. Turn it into a HOST / CO-HOST podcast dialogue:\n\n${stripped}`
        : `Here is today's briefing. Turn it into a narration script:\n\n${stripped}`;

    const response = await anthropic.messages.create(
      {
        model: SCRIPT_MODEL,
        max_tokens: 4096,
        system: buildSystemPrompt(config),
        messages: [{ role: "user", content: userPrompt }],
      },
      { timeout: 2 * 60 * 1000 }, // 2-minute timeout; catch block falls back to stripped text
    );
    const out = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
    if (out) return out;
    logger.warn("Briefing script rewrite returned empty; using stripped text");
    return stripped;
  } catch (err) {
    logger.warn(
      { err },
      "Briefing script rewrite failed; falling back to stripped text",
    );
    return stripped;
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export function chunkScript(script: string, limit = TTS_CHUNK_LIMIT): string[] {
  if (script.length <= limit) return [script];
  const chunks: string[] = [];
  const pieces = script.match(/[^.!?\n]+[.!?\n]*/g) ?? [script];
  let current = "";
  for (const piece of pieces) {
    if (current.length + piece.length > limit && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    if (piece.length > limit) {
      for (let i = 0; i < piece.length; i += limit) {
        chunks.push(piece.slice(i, i + limit).trim());
      }
      continue;
    }
    current += piece;
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// OpenAI TTS synthesis
// ---------------------------------------------------------------------------

// 90-second timeout per TTS chunk attempt.
const TTS_CHUNK_TIMEOUT_MS = 90 * 1000;
// Retry up to 3 times with exponential backoff before giving up.
const TTS_MAX_RETRIES = 3;

async function synthesizeChunk(
  apiKey: string,
  input: string,
  voice: string,
): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= TTS_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TTS_CHUNK_TIMEOUT_MS);
    try {
      const res = await fetch(OPENAI_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TTS_MODEL,
          voice,
          input,
          response_format: "mp3",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const excerpt = (await res.text().catch(() => "")).slice(0, 500);
        throw new Error(`OpenAI TTS ${res.status}: ${excerpt}`);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < TTS_MAX_RETRIES) {
        const backoffMs = attempt * 5000;
        logger.warn(
          { err, attempt, backoffMs },
          `TTS chunk attempt ${attempt} failed — retrying in ${backoffMs / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// Parse a dialogue script into ordered speaker turns.
// Expected line format: "[HOST]: <text>" or "[CO-HOST]: <text>"
function parseDialogueTurns(
  script: string,
): Array<{ speaker: "HOST" | "COHOST"; text: string }> {
  return script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("[HOST]:") || l.startsWith("[CO-HOST]:"))
    .map((l) => {
      if (l.startsWith("[HOST]:")) {
        return { speaker: "HOST" as const, text: l.slice("[HOST]:".length).trim() };
      }
      return { speaker: "COHOST" as const, text: l.slice("[CO-HOST]:".length).trim() };
    })
    .filter((t) => t.text.length > 0);
}

export async function synthesizeSpeech(
  script: string,
  config: PodcastConfig = DEFAULT_PODCAST_CONFIG,
): Promise<SynthesisResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new TtsNotConfiguredError();
  const trimmed = script.trim();
  if (!trimmed) throw new Error("synthesizeSpeech called with empty script");

  const buffers: Buffer[] = [];

  if (config.format === "dialogue") {
    const turns = parseDialogueTurns(trimmed);
    if (turns.length === 0) {
      // Claude didn't produce labelled turns — fall back to single narrator.
      logger.warn(
        "Dialogue script parsing produced no turns — falling back to single narrator",
      );
      for (const chunk of chunkScript(trimmed)) {
        buffers.push(await synthesizeChunk(apiKey, chunk, config.hostVoice));
      }
    } else {
      for (const turn of turns) {
        const voice = turn.speaker === "HOST" ? config.hostVoice : config.cohostVoice;
        for (const chunk of chunkScript(turn.text)) {
          buffers.push(await synthesizeChunk(apiKey, chunk, voice));
        }
      }
    }
  } else {
    for (const chunk of chunkScript(trimmed)) {
      buffers.push(await synthesizeChunk(apiKey, chunk, config.voice));
    }
  }

  const audio = Buffer.concat(buffers);
  const estimatedDurationSeconds = Math.max(
    1,
    Math.round(trimmed.length / CHARS_PER_SECOND),
  );
  return { audio, estimatedDurationSeconds };
}
