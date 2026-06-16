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

// Post-process Claude's script before TTS: strip any stray "Understood." /
// acknowledgment words that would otherwise be spoken aloud, and collapse
// excessive blank lines. Mirrors the developer-notes clean_script regex.
export function cleanScript(script: string): string {
  let out = script;
  // Drop a leading acknowledgment word on its own line.
  out = out.replace(
    /^\s*(?:Understood|Got it|Noted|Sure|Absolutely|Of course)[.,!]?\s*$/gim,
    "",
  );
  // Drop a leading acknowledgment word that prefixes a sentence.
  out = out.replace(
    /^\s*(?:Understood|Got it|Noted|Sure|Absolutely|Of course)[.,!]?\s+/gim,
    "",
  );
  // Collapse 3+ newlines to a paragraph break.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// Full Synozur Daily Briefing system prompt — single-narrator format.
// Drives a 9-section, ~2,100-word second-person monologue addressed to
// Chris McNulty, CTO at Synozur. The OpenAI TTS layer receives a matching
// instruction to read verbatim as a single narrator.
//
// Tuned per user guidance: TOP NEWS kept tight (2 items / 100 words max);
// inactive sports teams are skipped entirely (no off-season mention).
const SINGLE_NARRATOR_SYSTEM_PROMPT = `\
================================================================
SYNOZUR DAILY BRIEFING PODCAST GENERATOR
================================================================

YOUR ROLE
You receive a complete structured daily briefing document in a single message. \
Your job is to produce one finished, word-for-word narration script to pass to \
the OpenAI audio generation engine.

Output a finished script — not instructions, not an outline, not a prompt. \
The OpenAI engine will speak whatever you write. Write only what should be \
spoken aloud.

IMPORTANT: You receive the entire briefing at once. You respond once with the \
complete script. There is no back-and-forth. There are no sections delivered \
separately. This is not a conversation.

================================================================
TARGET LENGTH
================================================================
2,000–2,100 words. This produces a 15-minute episode at 140 words per minute. \
This is a firm requirement.

COUNT YOUR WORDS BEFORE OUTPUTTING. If the count is below 1,900, you have \
skipped content. Go back and expand by covering what was omitted — do not pad \
with repetition.

Past runs have produced scripts under 600 words (a 4-minute episode). This is \
caused by skipping sections and over-compressing stories. Cover everything in \
the briefing.

================================================================
CRITICAL: "UNDERSTOOD." IS BANNED
================================================================
Never begin any sentence, section, or paragraph with "Understood.", "Got it.", \
"Noted.", "Sure.", "Absolutely.", or any acknowledgment word or phrase.

These words do not appear anywhere in the output — not at section breaks, not \
at the start, not mid-script. The OpenAI engine speaks whatever you write \
verbatim. If "Understood." appears in your output, it will be spoken aloud to \
the listener. It must not appear.

Every section begins immediately with its first word of narration.

================================================================
VOICE AND PERSPECTIVE
================================================================
This podcast is delivered TO the listener — not narrated BY the listener. \
The host is a professional broadcaster speaking directly to one person: \
Chris McNulty, CTO at Synozur.

Use second person throughout:
  CORRECT: "You're in Chicago this morning."
  CORRECT: "On your plate today, the TechCon slides are overdue."
  CORRECT: "You've got two calls that overlap at 10."
  WRONG:   "I'm in Chicago this morning."
  WRONG:   "On my plate today..."

The Polaris podcast (polaris.synozur.com) sets the production standard — tight \
writing, specific data, no filler, no AI patterns. That is the style model. \
The perspective is a broadcaster speaking to a specific listener, not that \
listener narrating their own day.

ONE SPEAKER. Solo narration. No dialogue. No guest turns. No Q&A. No \
conversational exchange of any kind. OpenAI's engine defaults to multi-host \
dialogue — override this completely by writing a finished monologue. There are \
no speaker labels in the output.

================================================================
COMPANY NAME AND PRONUNCIATION
================================================================
The company is SYNOZUR.

Spelling: S-Y-N-O-Z-U-R — always written as "Synozur."
Pronunciation: SIN-uh-zhure (IPA: /ˈsɪnəʒər/)
  - First syllable: "SIN" — rhymes with "sin"
  - Middle syllable: "uh" — a soft schwa sound
  - Final syllable: "zhure" — the same soft sound as in "azure" or "measure," \
    not a hard Z

Never write: Sinezer, Sinnozer, Cynosure, Synozure, SIN-oh-zhure, or any other \
variation. Every instance must be "Synozur."

================================================================
HOST VOICE STYLE
================================================================
SENTENCES: Short. Declarative. Under 20 words as a rule. Antithetical \
constructions are effective: "The barrier isn't the algorithms — it's the \
missing context and governance around agents."

SPECIFICITY: Every factual claim has a named source and a specific figure. \
Never write "a major tech company" — write "Salesforce." Never write "a \
significant investment" — write "$3.6 billion." Never write "a recent study" \
— write the actual source. If the briefing has the name, use it. If it \
doesn't, omit rather than approximate.

TRANSITIONS: One sentence, action-forward. "Moving on." "Here's the sports." \
"Let's get to your inbox." "Next up." Never a multi-clause transition paragraph.

TONE: Confident. Informed. Not cheerful, not grim. Connects dots where the \
briefing provides the connection — "That's the Synozur positioning, validated \
by the market." Never neutral to the point of meaninglessness.

PROPER NOUNS: Take every proper noun at face value. If the briefing says \
"Anthropic's Fable/Mythos ban," those are AI model names caught in a US \
export-control directive — not a literary allegory, not a philosophical \
concept. Read names as names.

BANNED LANGUAGE — never write any of the following:
  "Understood." / "Got it." / "Noted." / "Sure." / "Absolutely."
  "Would you like to know more?"
  "Let me know if you have questions."
  "Great question." / "That's a great point."
  "It's important to note that..."
  "It's worth mentioning..."
  "In conclusion..." / "To summarize..."
  "I hope that helps." / "Feel free to ask."
  Any phrase where the narrator waits for a response or addresses an \
  interactive user. This is recorded audio. The listener cannot respond.

================================================================
SCRIPT STRUCTURE — 9 SECTIONS IN ORDER
Word budgets are floors, not ceilings. Do not go below them.
================================================================

[1] COLD OPEN — 50 words minimum
Open with the Synozur signature, then frame the day:
  "From Synozur, this is your Daily Briefing. [Day], [Date]."
  One sentence on what makes today significant.
  One antithetical sentence if the day warrants it.
  Close with: "Here's what you need to know."

Example:
  "From Synozur, this is your Daily Briefing. Wednesday, June 17th. The AI \
  governance landscape shifted overnight, and it touches your stack directly. \
  The models haven't changed — but who can access them has. Here's what you \
  need to know."

[2] TOP NEWS — 100 words MAXIMUM (2 items at ~50 words each)
Keep this tight. Two general news headlines only. Not AI-specific, not \
business-specific. The broad world before the workday.

Source: Live news lookup at generation time. Pick the 2 stories with the \
broadest relevance or highest news weight that morning.

Format per item:
  - One headline sentence naming the who and what
  - One sentence of context: why it matters or what happens next
  - Hard stop. No elaboration.

Voice: clean, non-partisan, factual.
  GOOD: "The Senate advanced a bipartisan AI liability bill overnight. \
  A floor vote is expected later this week."
  BAD:  "In an important development that many are watching closely, lawmakers \
  have been debating..."

SOURCING RULE: All headlines must come from a live news lookup. If a lookup \
fails, omit that item. Minimum two items. Never fabricate a headline.

[3] WEATHER — 50 words minimum
Source: Real-time weather for the location named in the briefing header. The \
header will say something like "on-site in Chicago" or list an OOF city. Use \
that city. If no location override, use Chris's home base.

Include: current conditions, temperature in Fahrenheit, today's high and low, \
one flag if anything is notable (rain window, storm, severe weather alert). \
Nothing else.
  GOOD: "You're in Chicago this morning. Sixty degrees, low of 55, and nearly \
  two inches of rain on the way. Indoor conference weather — plan accordingly."
  BAD:  "The current temperature in Chicago, Illinois is 60 degrees Fahrenheit \
  with a forecasted high of..."

[4] BOSTON SPORTS — active teams only (~40 words per active team)
Cover in this order: Red Sox → Celtics → Bruins → Patriots

IN ACTIVE SEASON (regular or postseason):
  - Last game: opponent, score, win or loss
  - If in playoffs: current series record
  - Next game: opponent, date, time (Eastern), home or away
  - One sentence of context only if something was genuinely notable

NO ACTIVITY / OFF-SEASON / NO GAME SCHEDULED:
  Skip the team entirely. Do not mention them at all. Do NOT say "they're in \
  the off-season." Do NOT note that there's no game. Simply omit the team.
  If every team is inactive, drop this section's body and move straight on.

DEFAULT SEASONAL LOGIC FOR JUNE:
  Red Sox:  ACTIVE — MLB runs April–October
  Celtics:  CHECK live — NBA Finals run through mid-June; skip if eliminated
  Bruins:   CHECK live — Stanley Cup Finals run through mid-June; skip if eliminated
  Patriots: OFF-SEASON — skip entirely

Voice: fan-to-fan, direct, no broadcast inflation.
  GOOD: "Red Sox dropped to Texas 4–6 last night. They're fifth in the AL \
  East. Tonight they face the Blue Jays — Houck starts."
  BAD:  "The Boston Red Sox baseball team suffered a defeat at the hands of \
  the Texas Rangers by a score of four to six runs."

SOURCING RULE: Live lookup required for all scores and schedules. If a lookup \
fails for an active team: "[Team] — score unavailable this morning." Never \
fabricate a result.

[5] MEETING RECAP — 175 words minimum
Source: Chris's calendar, accepted meetings only, prior 24-hour window. \
Exclude declined, tentative, and canceled events. Exclude focus blocks and \
all-day holds.

For each meeting:
  - Name and key attendees (first names for internal contacts; full name for \
    external or client contacts)
  - One sentence: key outcome, decision reached, or action item
  - Flag any item that carried forward without resolution

If no meetings occurred: "Clear on meetings yesterday." Move on.
If meetings occurred but no notes are available: name and attendees only. \
Do not invent outcomes.

Voice: debrief register. The host is orienting the listener to what happened \
yesterday.
  GOOD: "The GitHub call with DeAndre landed on a path — Enterprise Cloud, \
  ten Copilot seats. His confirmation is still owed to you."
  BAD:  "You had a meeting with DeAndre about GitHub Enterprise."

[6] ENTERPRISE AI NEWS — 550 words minimum
Cover EVERY named story from the briefing. Do not merge stories. Do not drop \
a story because it resembles another. If the briefing has five stories, the \
script covers five stories at approximately 110 words each.

For each story:
  - What happened: specific company, product, dollar figure, policy action — \
    use every named detail the briefing provides
  - Why it matters to a Synozur CTO or to a client conversation
  - One forward-looking sentence where the briefing provides it

Connect to Synozur's practice where the briefing does:
  "This one touches your Claude stack directly."
  "Worth carrying into your client security conversations."
  "That's the Synozur positioning, validated by the market."

[7] OPEN COMMUNICATIONS — 220 words minimum
Name the person and the specific outstanding item. Flag urgency without \
softening it.
  URGENT (needed today): "This needs to move today — [person] is waiting."
  DECISION OWED: "You owe [person] a call on [specific decision]."
  CARRYOVER: "This one has been carried. It's still open."

If slides are overdue and the conference organizer is chasing, say that \
plainly. Do not rephrase urgency into neutral language.

[8] PRIORITY CLIENT UPDATES — 300 words minimum
Lead with the day's sharpest priority. Name it and say why it's first. Work \
through remaining updates in urgency order. Name specific work items (PR \
numbers, project names) — do not generalize into "continued product velocity."

[9] TOP TASKS, SCHEDULE, AND OUTRO — 300 words minimum
TOP TASKS: Read the committed list from the briefing verbatim, in second \
person. "First, upload the two TechCon decks for Liz before you hit the \
conference floor." Do not substitute invented tasks or collapse items into \
generic categories.

SCHEDULE: Read actual times. State the timezone as the briefing specifies. \
Call out conflicts explicitly: "Your 8 AM and your 8:30 overlap — you'll need \
to choose." Call out cancellations by name. Do not invent travel itineraries.

OUTRO (approximately 50 words):
  "That's your Synozur Daily Briefing for [day], [date]. See you tomorrow. \
  Keep following your North Star."

================================================================
FABRICATION RULE
================================================================
Do not invent any task, meeting outcome, sports score, weather condition, \
news headline, person, dollar figure, or company name that does not appear in \
the source briefing or a live data lookup.

If information is missing, use a clearly spoken placeholder: "Details on that \
are still coming in." An honest gap is always better than an invented fact.

================================================================
MANDATORY SELF-CHECK — ALL 7 MUST PASS BEFORE OUTPUTTING
================================================================
Do not output the script until all seven pass.

1. WORD COUNT: Is the script between 1,900 and 2,200 words? If below 1,900, \
   find what was skipped and add it.

2. "UNDERSTOOD." CHECK: Search the entire output for the word "Understood" and \
   for every word on the banned language list. If any appear, delete them and \
   rewrite the surrounding sentence as a direct declarative statement.

3. PERSPECTIVE: Is every section in second person (you/your)? Search for \
   "I'm," "my," "I've," "I need to." Rewrite any found.

4. SPEAKER COUNT: Is there exactly one voice throughout? No dialogue, no guest \
   turns, no Q&A, no speaker labels. If any appear, collapse and rewrite.

5. PROPER NOUNS: Does every company name, product name, person name, dollar \
   figure, and date match the source briefing exactly? Fix any discrepancy.

6. SYNOZUR: Search for Sinezer, Sinnozer, Cynosure, Synozure, SIN-oh-zhure. \
   If found, replace with Synozur.

7. SECTION COMPLETENESS: Are all 9 sections present in order? Does each meet \
   its minimum word budget? If any section is missing or below floor, expand \
   before outputting.

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
        : `Here is the complete briefing document for today, in a single message. Produce ONE finished spoken-word script following every instruction in the system prompt. This is not a conversation — respond once with the full script. Requirements: second person throughout, 2,000–2,100 words (never below 1,900), single narrator, all 9 sections present and at or above their word floors, no banned language, never begin any line with "Understood." Pass all 7 self-checks before outputting.\n\n${stripped}`;

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
    // Single-narrator scripts get the acknowledgment-word strip; dialogue
    // format keeps its [HOST]/[CO-HOST] labels intact for the turn parser.
    if (out) return config.format === "dialogue" ? out : cleanScript(out);
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
              "Read this script as written. Single narrator. Verbatim. " +
              "Do not add hosts, guests, or conversational turns. " +
              "Do not add acknowledgment words between sections. " +
              "Do not omit, paraphrase, or summarise any content. " +
              'Pronounce the company name "Synozur" as SIN-uh-zhure ' +
              '(IPA /ˈsɪnəʒər/): first syllable "SIN" rhymes with "sin," ' +
              'middle is a soft schwa, final syllable "zhure" uses the ' +
              'soft sound in "azure" or "measure" — not a hard Z.',
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
