---
name: gpt-audio TTS drift
description: Why the briefing podcast audio "rewrites" the script, and the only reliable fix
---

# gpt-audio is conversational, not a verbatim TTS engine

The briefing podcast synthesizes audio with OpenAI `gpt-audio` via **chat
completions** (the Replit AI Integrations proxy does NOT proxy `/v1/audio/speech`
— `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd` all return `400 Endpoint 'POST
/audio/speech' is not supported`). `gpt-audio` is a speech-to-speech *chat*
model: handed a script as a user message, it **responds** to it instead of
reading it.

**Symptoms (all came from the synthesis stage, not Claude's script):**
- Chunks prefaced with "Understood." / "Got it." / "Noted."
- Script paraphrased into bullet summaries; content dropped (e.g. the outro)
- Tacked-on "Let me know if you need help" / offers to assist
- Worse with the real ~10k-char script: it's chunked (~3500-char limit) and each
  chunk is a fresh conversation, so mid-script fragments (starting mid-sentence)
  are the ones the model "reacts" to most — hence *multiple* acknowledgments.

**Why a perfect Claude prompt didn't fix it:** the script was fine (logs showed
`script ready scriptLength≈10k`, no fallback). `cleanScript()` only sanitizes
Claude's output — it never touches what `gpt-audio` generates.

**Fix (verified empirically against mid-script fragments):** frame the
`gpt-audio` *system* message as a pure TTS engine — "You are a text-to-speech
engine, not an assistant. Convert the user's text to speech EXACTLY as written…
speak ONLY the user's text — no greeting, no acknowledgment, no commentary, no
closing remark, no offer to help." With this framing it reads mid-sentence
fragments verbatim. The weaker "Read this script as written, verbatim" framing
did NOT stop the drift.

**How to apply:** any time gpt-audio (or a speech-to-speech chat model) is used
for TTS of pre-written text, cast it explicitly as a non-assistant TTS engine in
the system role. Don't expect "read verbatim" alone to hold. A pronunciation
note can live in that same system message as long as it's marked "do not speak
this note" — it won't be spoken and doesn't break verbatim reading.
