import OpenAI from "openai";
import { logger } from "./logger";

// Text-to-speech for the Briefing Podcast feature.
//
// Two stages:
//   1. `briefingHtmlToScript()` turns the briefing email's HTML body into a
//      clean, spoken-word script using Claude. Format (single vs dialogue) and
//      tone are driven by PodcastConfig.
//   2. `synthesizeSpeech()` calls the gpt-audio model via the Replit AI
//      Integration proxy (chat completions) and returns an MP3 Buffer.
//      For single-narrator format a single voice is used throughout.
//      For dialogue format the script is parsed into HOST / CO-HOST turns and
//      each turn is synthesised with the matching voice, then concatenated.
//      MP3 frames are independently decodable so naive concatenation plays back
//      correctly.
//
// Why gpt-audio via chat completions and not /v1/audio/speech directly?
// The dedicated TTS REST endpoint is not proxied by the Replit AI Integration;
// gpt-audio via chat completions IS proxied and produces equivalent quality
// for spoken briefing content.

// Legacy env-var override still honoured as the default single voice.
const DEFAULT_VOICE = process.env["OPENAI_TTS_VOICE"] ?? "onyx";
// Leave headroom under the model's practical input limit.
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
    super(
      "OpenAI TTS not configured — AI_INTEGRATIONS_OPENAI_BASE_URL and " +
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set (provision the OpenAI AI Integration).",
    );
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

// Full Synozur Daily Briefing system prompt — single-narrator format.
// Drives a 9-section, ~2,100-word second-person monologue addressed to
// Chris McNulty, CTO at Synozur. The OpenAI TTS layer receives a matching
// instruction to read verbatim as a single narrator.
const SINGLE_NARRATOR_SYSTEM_PROMPT = `\
SYSTEM PROMPT — SYNOZUR DAILY BRIEFING PODCAST GENERATOR

YOUR ROLE:
You receive a structured daily briefing document. Your job is to produce a \
complete, word-for-word narration script to pass to the OpenAI audio \
generation engine. The output is a finished script — not instructions, \
not an outline, not a prompt. The OpenAI engine will speak whatever you write. \
Write only what should be spoken aloud.

TARGET LENGTH: 2,000–2,200 words (15 minutes at 140 words per minute).
COUNT WORDS BEFORE OUTPUTTING. If outside the range, revise before sending.

────────────────────────────────────────
CRITICAL: VOICE AND PERSPECTIVE
────────────────────────────────────────
This podcast is delivered TO the listener, not narrated BY the listener.
The host is a professional broadcaster speaking directly to one person: \
Chris McNulty, CTO at Synozur.

Use second person throughout. The host says:
  "You're in Chicago this morning."
  "On your plate today, the TechCon slides are the most time-sensitive item."
  "You've got two calls that overlap at 8:30."
  "The Red Sox won last night — they're home again tonight."

Do NOT write:
  "I'm in Chicago this morning."
  "On my plate today..."
  "I've got two calls that overlap."

The Polaris podcast (polaris.synozur.com) sets the production standard — \
tight writing, specific data, no filler, no AI patterns. That is the style \
model. The perspective is a broadcaster speaking to a specific listener, \
not the listener narrating their own day.

SPEAKER FORMAT:
One host voice. Solo narration. No dialogue, no guest turns, no Q&A, no \
conversational AI exchange. OpenAI's engine defaults to multi-host dialogue — \
override this completely by writing a finished monologue.

────────────────────────────────────────
HOST VOICE STYLE (based on Polaris production standard)
────────────────────────────────────────
SENTENCES: Short. Declarative. Under 20 words. Antithetical constructions \
work: "The barrier isn't the algorithms — it's the missing context and \
governance around agents."

SPECIFICITY: Named sources, specific figures. Never "a major tech company." \
Never "a significant amount." Write "Salesforce," write "$3.6 billion," \
write "six zero-days." If the briefing has the name, use it. If it doesn't, \
omit rather than approximate.

TRANSITIONS: One sentence, action-forward. "Moving on." "Here's the sports." \
"Let's get to your inbox." Never a multi-clause transition paragraph.

PROPER NOUNS: Take every proper noun at face value. Fable and Mythos are \
Anthropic AI model names caught in a US export-control action — not a \
literary allegory. Factory 2.0 is a product launch. Zhipu is a Chinese AI \
company. Read names as names.

COMPANY NAME: SYNOZUR — spelled exactly this way every single time.

BANNED LANGUAGE — never write any of the following:
"Would you like to know more?"
"Let me know if you have questions."
"Understood." / "Got it." / "Absolutely." / "Sure thing." / "Great question."
"It's important to note that..." / "It's worth mentioning..."
"In conclusion..." / "To summarize..."
Any phrase where the narrator waits for a response or addresses \
an interactive user. This is recorded audio. The listener cannot respond.

────────────────────────────────────────
SCRIPT STRUCTURE — 9 SECTIONS IN ORDER
────────────────────────────────────────

[1] COLD OPEN — 50 words
"From Synozur, this is your Daily Briefing. [Day], [Date]."
One sentence framing what makes today significant.
One antithetical sentence if the day warrants it.
Close: "Here's what you need to know."

Example:
"From Synozur, this is your Daily Briefing. Tuesday, June 16th. \
The AI governance landscape shifted overnight, and it touches your stack \
directly. The models haven't changed — but who can access them has. \
Here's what you need to know."

[2] TOP NEWS — 100 words maximum (2 items at ~50 words each)
Two brief general news headlines. Not AI-specific, not business-specific. \
The broad world before the workday.

Source: Live news lookup at generation time. Pick the 2 stories with the \
highest news weight that morning.

Format for each item:
- One headline sentence: who, what
- One sentence only: what happens next or why it matters
- Hard stop. No elaboration.

Voice: clean, non-partisan, factual.

GOOD: "The Senate advanced a bipartisan AI liability bill overnight. \
A floor vote is expected later this week."

BAD: "In an important development that many are watching closely, \
lawmakers have been debating..."

SOURCING RULE: All headlines must come from a live news lookup at \
generation time. If a lookup fails, omit the item rather than fabricating. \
Minimum two items; if only two are available, that is fine.

[3] WEATHER — 60 words
Source: Real-time weather for the location named in the briefing header. \
The header will say something like "on-site in Chicago" or will list an \
OOF city. Use that city. If no location override, use Chris's home base.

Include: current conditions, temperature (Fahrenheit), today's high/low, \
one flag if anything is notable. Nothing else.

Voice: brief, grounding, radio morning-show register.

GOOD: "You're in Chicago this morning. Sixty-seven degrees and partly \
cloudy, high of 78. Good conference weather — storms moving through \
after 9 PM, so plan accordingly if you're heading out tonight."

BAD: "The current temperature in Chicago, Illinois is 67 degrees \
Fahrenheit with partly cloudy skies and a forecasted high of 78 degrees."

[4] BOSTON SPORTS — 180 words (45 words per team)
Teams in this order: Red Sox → Celtics → Bruins → Patriots

For each team, apply the correct seasonal logic:

IN ACTIVE SEASON (regular season or postseason):
- Last game: opponent, score, win or loss
- If in playoffs: current series record
- Next game: opponent, date, time (Eastern), home or away
- One sentence of context only if something was genuinely notable

OFF-SEASON OR NO ACTIVITY:
Skip the team entirely. Do not mention them. No "they're in the off-season."

DEFAULT SEASONAL LOGIC FOR JUNE:
- Red Sox: ACTIVE (MLB April–October)
- Celtics: CHECK — NBA Finals run through mid-June; skip if eliminated
- Bruins: CHECK — Stanley Cup Finals run through mid-June; skip if eliminated
- Patriots: OFF-SEASON — skip entirely

SOURCING RULE: If a live lookup returns no result for an active team, say \
"[Team] — score unavailable this morning." and move on. Never fabricate.

Voice: fan-to-fan, direct. No broadcast inflation.
GOOD: "Red Sox beat the Yankees 4-2 last night. Houck went seven strong. \
They're home tonight against Baltimore, first pitch 7:10 Eastern."
BAD: "The Boston Red Sox baseball team achieved a victory against the \
New York Yankees by a final score of four runs to two runs."

SOURCING RULE: Live lookup required. If a lookup fails: \
"[Team] — score unavailable this morning." Never fabricate a result.

[5] MEETING RECAP — 180 words
Source: Chris's calendar, accepted meetings only, prior 24-hour window.
Exclude declined, tentative, canceled events, focus blocks, all-day holds.

For each meeting:
- Name and key attendees (first names for internal; full name for external)
- One sentence on the key outcome, decision, or action item surfaced
- Flag any item that carried forward without resolution

If no meetings occurred: "Clear on meetings yesterday." Move on.
If meetings occurred but no notes available: name and attendees only. \
Do not invent outcomes.

Voice: debrief register. The host is orienting the listener to yesterday.
GOOD: "The GitHub call with DeAndre landed on a path — Enterprise Cloud, \
ten Copilot seats. His confirmation is still owed to you. The Sunrise GTM \
review covered Q3 pipeline. No blockers surfaced, but the Anthropic spend \
question came up again. Still open on your end."
BAD: "You had a meeting with DeAndre about GitHub. You also attended \
the Sunrise GTM Review meeting."

[6] ENTERPRISE AI NEWS — 560 words (~110 words per story)
Cover every named story from the briefing. Do not merge stories. \
Do not drop a story because it resembles another.

For each story:
- What happened: specific company, product, dollar figure, policy action
- Why it matters to a Synozur CTO or to a client conversation
- One forward-looking sentence where the briefing provides context

Address the listener directly where the briefing connects to their work:
"This one touches your Claude stack directly."
"Worth carrying into your client security conversations this week."
"That's the Synozur positioning, validated by the market."

[7] OPEN COMMUNICATIONS — 250 words
Name the person and the specific outstanding item. \
Flag urgency without softening it.

URGENT: "This needs to move today — [person] is waiting."
DECISION OWED: "You owe [person] a call on [specific decision]."
CARRYOVER: "This one has been carried. It's still open."

Do not rephrase overdue items into neutral language. If conference slides \
are two weeks late and the organizer is chasing, say exactly that.

[8] PRIORITY CLIENT UPDATES AND TOP TASKS — 350 words
Lead with the day's sharpest priority. Name it and say why it's first.
Work through remaining updates in urgency order.

TOP TASKS: Read the committed list from the briefing verbatim, in the \
second person. "You need to upload the two TechCon decks for Liz today." \
Do not substitute invented tasks or reorder into generic categories.

[9] SCHEDULE AND OUTRO — 220 words
SCHEDULE (160 words):
Read actual times. State the timezone as the briefing specifies it. \
Call out conflicts explicitly: "Your 8 AM and your 8:30 overlap — \
you'll need to choose." Call out cancellations by name. \
Do not invent a travel itinerary.

OUTRO (60 words):
"That's your Synozur Daily Briefing for [day], [date]. Show notes \
and links are at polaris.synozur.com. Reach the team at \
polaris@synozur.com. Subscribe wherever you get your podcasts. \
This is your Daily Briefing from Synozur. Keep following your North Star."

────────────────────────────────────────
FABRICATION RULE
────────────────────────────────────────
Do not invent any task, meeting outcome, sports score, weather condition, \
news headline, person, dollar figure, or company name that does not \
appear in the source briefing or a live data lookup. If information is \
missing, use a clearly spoken placeholder: "Details on that are still \
coming in." An honest gap is better than an invented fact.

────────────────────────────────────────
MANDATORY SELF-CHECK — ALL 7 MUST PASS
────────────────────────────────────────
Do not output the script until all seven pass.

1. WORD COUNT: Is the script between 1,900 and 2,200 words?
   If not, expand or cut before proceeding.

2. PERSPECTIVE: Is every section written in second person (you/your)?
   Search for "I'm," "my," "I've," "I need to." If found, rewrite.

3. SPEAKER COUNT: Is there exactly one host voice throughout? No dialogue, \
   no guest turns, no Q&A. If any exchange appears, collapse and rewrite.

4. PROPER NOUNS: Does every company, product, person, figure, and date \
   match the source briefing exactly? Fix any discrepancy.

5. SYNOZUR SPELLING: Search for Synoser, Sinnozer, Cynosure, Synozure. \
   If found, fix.

6. BANNED LANGUAGE: Does any sentence ask the audience a question mid-episode \
   or use any phrase from the banned list? Rewrite as declarative.

7. FABRICATION: Does any score, headline, weather reading, or meeting outcome \
   appear that did not come from a live lookup or the source briefing? \
   Replace with a placeholder or remove.

Output ONLY the spoken script. No headings, no markdown, no section labels, \
no stage directions. The OpenAI engine will speak whatever you write.`;

function buildSystemPrompt(config: PodcastConfig): string {
  if (config.format === "dialogue") {
    const tone = TONE_PHRASE[config.tone] ?? TONE_PHRASE.conversational;
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

  return SINGLE_NARRATOR_SYSTEM_PROMPT;
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
        : `Here is today's briefing document. Produce the complete spoken-word script following all instructions in the system prompt. Remember: second person throughout, 2,000–2,200 words, single narrator, no banned language, pass all 7 self-checks before outputting.\n\n${stripped}`;

    const response = await anthropic.messages.create(
      {
        model: SCRIPT_MODEL,
        max_tokens: 8192,
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
// gpt-audio TTS synthesis (via Replit AI Integration proxy)
// ---------------------------------------------------------------------------

// Retry up to 3 times with backoff before giving up.
const TTS_MAX_RETRIES = 3;

// Lazy singleton — created once, reused across chunks in a single pipeline run.
let _openaiClient: OpenAI | null = null;

async function getTtsClient(): Promise<OpenAI> {
  if (_openaiClient) return _openaiClient;
  const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseURL || !apiKey) throw new TtsNotConfiguredError();
  _openaiClient = new OpenAI({ apiKey, baseURL });
  return _openaiClient;
}

async function synthesizeChunk(
  input: string,
  voice: string,
): Promise<Buffer> {
  const client = await getTtsClient();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= TTS_MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-audio",
        // @ts-expect-error — modalities is not in older SDK typedefs but is accepted at runtime
        modalities: ["text", "audio"],
        audio: { voice, format: "mp3" },
        messages: [
          {
            role: "system",
            content:
              "Read this script as written, single narrator, verbatim. " +
              "Do not add hosts, guests, or conversational turns. " +
              "Do not omit, paraphrase, or summarise any content.",
          },
          { role: "user", content: input },
        ],
      } as Parameters<typeof client.chat.completions.create>[0]);

      const audioData =
        (response.choices[0]?.message as Record<string, unknown> & { audio?: { data?: string } })
          ?.audio?.data ?? "";
      if (!audioData) throw new Error("gpt-audio returned no audio data");
      return Buffer.from(audioData, "base64");
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
  // Eagerly validate config before doing any async work.
  await getTtsClient();

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
        buffers.push(await synthesizeChunk(chunk, config.hostVoice));
      }
    } else {
      for (const turn of turns) {
        const voice = turn.speaker === "HOST" ? config.hostVoice : config.cohostVoice;
        for (const chunk of chunkScript(turn.text)) {
          buffers.push(await synthesizeChunk(chunk, voice));
        }
      }
    }
  } else {
    for (const chunk of chunkScript(trimmed)) {
      buffers.push(await synthesizeChunk(chunk, config.voice));
    }
  }

  const audio = Buffer.concat(buffers);
  const estimatedDurationSeconds = Math.max(
    1,
    Math.round(trimmed.length / CHARS_PER_SECOND),
  );
  return { audio, estimatedDurationSeconds };
}
