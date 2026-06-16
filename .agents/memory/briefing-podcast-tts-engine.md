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

**Voice namespaces are NOT interchangeable, and each engine has its own DB
columns.** OpenAI voices (`briefingPodcastVoice`/`HostVoice`/`CohostVoice`, e.g.
`onyx`) feed only the gpt-audio path. Azure voices have their own columns
(`briefingPodcastAzureVoice`/`AzureHostVoice`/`AzureCohostVoice`, e.g.
`en-US-AndrewMultilingualNeural`) and feed only the Azure path. Don't feed an
OpenAI voice id to Azure or vice-versa.

**Azure voice precedence (admin-configurable):** DB-configured Azure voice →
`AZURE_SPEECH_VOICE`/`AZURE_SPEECH_COHOST_VOICE` env override → built-in defaults
(`en-US-AndrewMultilingualNeural` / `en-US-AvaMultilingualNeural`). The resolver
functions in `azureTts.ts` take an optional `configured?` arg; the briefing
pipeline reads the DB columns and passes them through `PodcastConfig` →
`synthesizeSpeech`. Valid Azure voices are a curated allow-list
(`VALID_AZURE_VOICES` in `azureTts.ts`, incl. Dragon HD `…:DragonHDLatestNeural`)
mirrored as friendly labels in the admin UI; the settings route validates against
it and exposes a `ttsEngine: "azure"|"openai"` indicator (from
`isAzureTtsConfigured()`) so the admin UI shows the right engine's voice picker.

**Synozur pronunciation:** Azure encodes it deterministically via SSML
`<phoneme alphabet="ipa" ph="ˈsɪnəʒər">Synozur</phoneme>` (built in
`buildSsml()` after XML-escaping). gpt-audio relies on a prompt hint instead.

**Endpoint:** region-derived `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`
(verified with westus2). Override with `AZURE_SPEECH_ENDPOINT` only for custom
resources.
