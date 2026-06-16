import { logger } from "./logger";

// Azure AI Speech (Neural TTS) synthesis for the Briefing Podcast.
//
// Azure is a purpose-built text-to-speech engine: it reads the supplied text
// verbatim with no "assistant" personality, so — unlike gpt-audio — it cannot
// inject acknowledgments ("Understood."), paraphrase, or drop the outro.
// Pronunciation of "Synozur" is encoded deterministically via an SSML
// <phoneme> tag rather than coaxed through a prompt.
//
// Config (secrets / env):
//   AZURE_SPEECH_KEY            (required) resource key
//   AZURE_SPEECH_REGION         (required unless ENDPOINT set) e.g. "eastus"
//   AZURE_SPEECH_ENDPOINT       (optional) full TTS endpoint override
//   AZURE_SPEECH_VOICE          (optional) single-narrator voice
//   AZURE_SPEECH_COHOST_VOICE   (optional) dialogue co-host voice

const AZURE_MAX_RETRIES = 3;

// Modern, natural neural voices. Andrew (multilingual) is a warm, conversational
// male voice that pairs well with the briefing's broadcaster tone.
const DEFAULT_SINGLE_VOICE = "en-US-AndrewMultilingualNeural";
const DEFAULT_COHOST_VOICE = "en-US-AvaMultilingualNeural";

// Curated allow-list of Azure Neural voices surfaced in the admin UI. Azure
// offers 100+ voices, but these are the broadcast-quality English voices worth
// offering for a daily briefing. The `:DragonHDLatest` entries are Azure's
// higher-fidelity "Dragon HD" voices. Keep this list in sync with
// AZURE_VOICE_OPTIONS in the synozur admin Briefing Podcast page.
export const VALID_AZURE_VOICES = [
  // Standard neural — male (US)
  "en-US-AndrewMultilingualNeural",
  "en-US-BrianMultilingualNeural",
  "en-US-GuyNeural",
  "en-US-DavisNeural",
  "en-US-SteffanNeural",
  "en-US-TonyNeural",
  // Standard neural — female (US)
  "en-US-AvaMultilingualNeural",
  "en-US-EmmaMultilingualNeural",
  "en-US-JennyNeural",
  "en-US-AriaNeural",
  "en-US-MichelleNeural",
  // Dragon HD (high definition)
  "en-US-Andrew:DragonHDLatestNeural",
  "en-US-Ava:DragonHDLatestNeural",
  "en-US-Emma:DragonHDLatestNeural",
  "en-US-Steffan:DragonHDLatestNeural",
  "en-US-Aria:DragonHDLatestNeural",
  // Other accents
  "en-GB-RyanNeural",
  "en-GB-SoniaNeural",
  "en-AU-NatashaNeural",
] as const;
export type AzureVoice = (typeof VALID_AZURE_VOICES)[number];

// IPA for "Synozur" → SIN-uh-zhure: /ˈsɪnəʒər/ (final syllable uses the soft
// "azure"/"measure" sound, not a hard Z).
const SYNOZUR_IPA = "ˈsɪnəʒər";

export function isAzureTtsConfigured(): boolean {
  const key = process.env["AZURE_SPEECH_KEY"]?.trim();
  const region = process.env["AZURE_SPEECH_REGION"]?.trim();
  const endpoint = process.env["AZURE_SPEECH_ENDPOINT"]?.trim();
  return Boolean(key && (region || endpoint));
}

// Voice resolution precedence: explicit configured voice (from site settings) →
// env override → built-in default. The configured value wins so admins can pick
// a voice in the UI without an env var or redeploy.
export function azureSingleVoice(configured?: string | null): string {
  return (
    configured?.trim() ||
    process.env["AZURE_SPEECH_VOICE"]?.trim() ||
    DEFAULT_SINGLE_VOICE
  );
}

export function azureCohostVoice(configured?: string | null): string {
  return (
    configured?.trim() ||
    process.env["AZURE_SPEECH_COHOST_VOICE"]?.trim() ||
    DEFAULT_COHOST_VOICE
  );
}

function ttsEndpoint(): string {
  const explicit = process.env["AZURE_SPEECH_ENDPOINT"]?.trim();
  if (explicit) return explicit;
  const region = process.env["AZURE_SPEECH_REGION"]?.trim();
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSsml(text: string, voice: string): string {
  // Escape first (so script content is XML-safe), then inject the phoneme tag
  // for "Synozur" (no special chars, so escaping leaves it intact).
  const body = escapeXml(text).replace(
    /Synozur/g,
    `<phoneme alphabet="ipa" ph="${SYNOZUR_IPA}">Synozur</phoneme>`,
  );
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xml:lang="en-US"><voice name="${voice}">${body}</voice></speak>`
  );
}

export async function azureSynthesizeChunk(
  input: string,
  voice: string,
): Promise<Buffer> {
  const key = process.env["AZURE_SPEECH_KEY"];
  if (!key) throw new Error("AZURE_SPEECH_KEY is not set");

  const url = ttsEndpoint();
  const ssml = buildSsml(input, voice);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= AZURE_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
          "User-Agent": "synozur-briefing-podcast",
        },
        body: ssml,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Azure TTS ${res.status}: ${detail.slice(0, 200)}`);
      }
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("Azure TTS returned empty audio");
      return Buffer.from(bytes);
    } catch (err) {
      lastErr = err;
      if (attempt < AZURE_MAX_RETRIES) {
        const backoffMs = attempt * 5000;
        logger.warn(
          { err, attempt, backoffMs },
          `Azure TTS chunk attempt ${attempt} failed — retrying in ${backoffMs / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastErr;
}
