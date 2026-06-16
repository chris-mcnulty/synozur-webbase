---
name: Briefing podcast TTS engine
description: Which engine narrates the Synozur Daily Briefing podcast and how engine/voice selection works
---

# Briefing podcast TTS engine selection

`synthesizeSpeech()` (api-server `lib/tts.ts`) picks the engine at runtime:

- **Azure AI Speech (Neural TTS) is PRIMARY** whenever `AZURE_SPEECH_KEY` plus
  `AZURE_SPEECH_REGION` (or `AZURE_SPEECH_ENDPOINT`) are set. It's a purpose-built
  TTS engine: reads text verbatim, so it does NOT add "Understood."/offers/
  paraphrase the way gpt-audio does. Lives in `lib/azureTts.ts`.
- **gpt-audio (OpenAI chat-completions proxy) is the FALLBACK** when Azure isn't
  configured. See `gpt-audio-tts-drift.md` for why it needs a strict TTS-engine
  system prompt.

**Why Azure was chosen:** user is on the Microsoft stack (Entra/Azure), Azure
neural TTS is ~$15/1M chars (≈$9/mo at ~20k chars/day, 500k/mo free tier), and
SSML gives deterministic pronunciation control. ElevenLabs (available via
Replit-managed billing, `external_apis` skill) is higher quality but ~10× the
cost; OpenAI `tts-1` is cheap but needs a separate OpenAI key (not proxied).

**Voice namespaces are NOT interchangeable.** Site-settings voices
(`briefingPodcastVoice` etc.) hold OpenAI names like `onyx` — these are only used
by the gpt-audio path. When Azure is active, voices come from
`AZURE_SPEECH_VOICE` / `AZURE_SPEECH_COHOST_VOICE` env (defaults
`en-US-AndrewMultilingualNeural` / `en-US-AvaMultilingualNeural`), NOT the DB
settings. Don't try to feed an OpenAI voice id to Azure or vice-versa.

**Synozur pronunciation:** Azure encodes it deterministically via SSML
`<phoneme alphabet="ipa" ph="ˈsɪnəʒər">Synozur</phoneme>` (built in
`buildSsml()` after XML-escaping). gpt-audio relies on a prompt hint instead.

**Endpoint:** region-derived `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`
(verified with westus2). Override with `AZURE_SPEECH_ENDPOINT` only for custom
resources.
