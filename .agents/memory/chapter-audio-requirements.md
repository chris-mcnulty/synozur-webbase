---
name: Chapter audio requirements
description: User-confirmed audience, voice, delivery, and retention requirements for chapter narration.
---

The chapter narration feature is for site administrators and site editors/authors, never Guest authors. All authorized editors and administrators may access the shared manuscripts and audio.

**Why:** The user explicitly defined this access boundary and shared visibility.

**How to apply:** Enforce access on both the interface and file/job endpoints; do not treat author ownership as the visibility boundary. Editorial users must be able to enter the CMS without membership in the separate administrator allow-list; never solve an editor entry failure by granting administrator access.

Use Microsoft Azure Dragon HD voices with a standard sample passage. Accept pasted text, text files, Markdown, and Word documents. MP3 is acceptable. Provide private downloads and job history rather than email notifications. The default retention is 30 days, with an explicit permanent-audio exception required under some circumstances.

**Why:** These were the user's selected first-release requirements.

**How to apply:** Keep uploaded manuscripts and generated audio private and out of GitHub. The approved design measures 30 days from initial submission, without extending expiry on retry.

The first release is English-only, with additional languages possible later. The user expects chapters of approximately 5,000–10,000 words, not entire books; the approved implementation design caps spoken text at 10,000 words including appended notes.

**Why:** The user described this intended scope and asked for advice about length and footnotes.

**How to apply:** Distinguish recommendations from approved requirements; do not silently omit uncertain footnotes or promise unmeasured rendering times.

Omit footnotes from narration by default and offer an option to append them as chapter notes.

**Why:** The user explicitly selected this option.

**How to apply:** Preserve reviewable extracted text and flag uncertain note detection.

Plan for a later addition allowing generated audio to be saved permanently on the site in selected circumstances, such as an on-demand audio version of a white paper. This is explicitly outside the first release. All authorized editors and administrators may save permanently when this capability is added; Guest authors remain excluded. Its publication workflow remains unconfirmed.

**Why:** The user explicitly requested this exception to automatic expiry, deferred implementation, and selected all authorized editors and administrators.

**How to apply:** Apply automatic expiry to every first-release job. Preserve a future explicit promotion path without implementing permanent saving now or assuming permission to publish manuscripts or audio.

Chapter narration must preserve reviewed wording and use the selected Azure Dragon HD voice without silent alternate-provider fallback.

**Why:** The approved chapter design is faithful narration, not the separately established briefing-podcast adaptation workflow.

**How to apply:** Do not reuse a podcast script-rewriting or fallback pipeline just because it already produces audio.

Cost visibility is for speech-cost estimates, not claims about actual Azure
charges. Use the user-approved standard estimate of **US$15 per million
characters**. The user says their usage has never been sufficient to generate
a bill; do not describe this estimate as a verified invoiced rate. Never show
missing pricing as zero. Later rate changes must not rewrite historical
estimates, and uncertain request outcomes must remain visibly uncertain.

**Why:** The user approved pre-generation estimates, per-job usage tracking and
an administrator monthly summary, then explicitly selected the standard
$15-per-million-character estimate instead of requiring a historical bill.

**How to apply:** Retain the rate basis for each estimate; distinguish retries,
samples, cached/reused audio and unpriced usage. Do not add spending controls or
claim invoice reconciliation without a separate request.
