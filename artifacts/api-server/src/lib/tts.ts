import { logger } from "./logger";

// Text-to-speech for the Briefing Podcast feature.
//
// Two stages:
//   1. `briefingHtmlToScript()` turns the briefing email's HTML body into a
//      clean, spoken-word script. It strips markup to readable text and then
//      (best-effort) asks Claude to rewrite it as a natural narration. If the
//      Anthropic integration isn't configured or errors, it falls back to the
//      stripped text so the pipeline still produces audio.
//   2. `synthesizeSpeech()` calls OpenAI's TTS endpoint and returns an MP3
//      Buffer. OpenAI caps input at ~4096 characters per request, so longer
//      scripts are chunked on sentence boundaries and the resulting MP3
//      segments are concatenated (MP3 frames are independently decodable, so
//      naive buffer concatenation plays back correctly).

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const TTS_MODEL = process.env["OPENAI_TTS_MODEL"] ?? "tts-1-hd";
const TTS_VOICE = process.env["OPENAI_TTS_VOICE"] ?? "onyx";
// Leave headroom under the 4096-char hard cap.
const TTS_CHUNK_LIMIT = 3500;
// ~150 spoken words/min ≈ ~900 chars/min → rough duration estimate.
const CHARS_PER_SECOND = 15;

const SCRIPT_MODEL = "claude-sonnet-4-6";

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

// Strip the briefing HTML down to readable plain text. The briefing emails
// use a simple structure (h1/h2 headings, ul/li bullets, p paragraphs, a
// table for the schedule), so a regex pass produces clean narration source
// without pulling in an HTML parser dependency.
export function stripBriefingHtml(html: string): string {
  let text = html;
  // Drop head/style/script wholesale.
  text = text.replace(/<head[\s\S]*?<\/head>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  // MSO conditional comments and HTML comments.
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Headings and block elements become paragraph breaks.
  text = text.replace(/<\/(h1|h2|h3|h4|p|li|tr|div)>/gi, "\n");
  text = text.replace(/<br\s*\/?>(?=)/gi, "\n");
  // Table cells get a separating space so "8:00am | Meeting" reads sensibly.
  text = text.replace(/<\/td>/gi, ": ");
  // Strip all remaining tags.
  text = text.replace(/<[^>]+>/g, "");
  // Decode the handful of entities the briefing uses.
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&middot;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'");
  // Collapse whitespace; keep paragraph breaks.
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return text.trim();
}

// Best-effort rewrite of the stripped text into a natural spoken narration.
// Falls back to the stripped text on any error so the pipeline never fails
// purely because the LLM rewrite was unavailable.
export async function briefingHtmlToScript(html: string): Promise<string> {
  const stripped = stripBriefingHtml(html);
  if (!stripped) return "";
  try {
    const { anthropic } = await import(
      "@workspace/integrations-anthropic-ai"
    );
    const response = await anthropic.messages.create({
      model: SCRIPT_MODEL,
      max_tokens: 4096,
      system:
        "You convert a written executive morning briefing into a natural, " +
        "spoken-word audio narration script. Keep all the facts, names, and " +
        "numbers. Open with a brief friendly intro, read each section " +
        "conversationally with smooth transitions, and close with a short " +
        "sign-off. Do not invent content. Output only the narration text — " +
        "no headings, no markdown, no stage directions.",
      messages: [
        {
          role: "user",
          content: `Here is today's briefing. Turn it into a narration script:\n\n${stripped}`,
        },
      ],
    });
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

// Split a script into <=TTS_CHUNK_LIMIT pieces on sentence/paragraph
// boundaries so no chunk exceeds OpenAI's input cap.
export function chunkScript(script: string, limit = TTS_CHUNK_LIMIT): string[] {
  if (script.length <= limit) return [script];
  const chunks: string[] = [];
  // Break into sentences (keep the delimiter) and greedily pack.
  const pieces = script.match(/[^.!?\n]+[.!?\n]*/g) ?? [script];
  let current = "";
  for (const piece of pieces) {
    if (current.length + piece.length > limit && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    // A single sentence longer than the limit gets hard-split.
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

async function synthesizeChunk(apiKey: string, input: string): Promise<Buffer> {
  const res = await fetch(OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const excerpt = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`OpenAI TTS ${res.status}: ${excerpt}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function synthesizeSpeech(
  script: string,
): Promise<SynthesisResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new TtsNotConfiguredError();
  const trimmed = script.trim();
  if (!trimmed) throw new Error("synthesizeSpeech called with empty script");

  const chunks = chunkScript(trimmed);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeChunk(apiKey, chunk));
  }
  const audio = Buffer.concat(buffers);
  const estimatedDurationSeconds = Math.max(
    1,
    Math.round(trimmed.length / CHARS_PER_SECOND),
  );
  return { audio, estimatedDurationSeconds };
}
