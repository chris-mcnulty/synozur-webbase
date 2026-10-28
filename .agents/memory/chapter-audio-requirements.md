---
name: Chapter audio requirements
description: User-confirmed audience, voice, delivery, and retention requirements for chapter narration.
---

The chapter narration feature is for site administrators and site editors/authors, never Guest authors. All authorized editors and administrators may access the shared manuscripts and audio.

**Why:** The user explicitly defined this access boundary and shared visibility.

**How to apply:** Enforce access on both the interface and file/job endpoints; do not treat author ownership as the visibility boundary.

Use Microsoft Azure Dragon HD voices with a standard sample passage. Accept pasted text, text files, Markdown, and Word documents. MP3 is acceptable. Provide private downloads and job history rather than email notifications. The default retention is 30 days, with an explicit permanent-audio exception required under some circumstances.

**Why:** These were the user's selected first-release requirements.

**How to apply:** Keep uploaded manuscripts and generated audio private and out of GitHub. Define the retention start point during design; it has not yet been agreed.

The first release is English-only, with additional languages possible later. The expected chapter size is approximately 5,000–10,000 words, not an entire book. A firm word limit remains unconfirmed.

**Why:** The user described this intended scope and asked for advice about length and footnotes.

**How to apply:** Distinguish recommendations from approved requirements; do not silently omit uncertain footnotes or promise unmeasured rendering times.

Omit footnotes from narration by default and offer an option to append them as chapter notes.

**Why:** The user explicitly selected this option.

**How to apply:** Preserve reviewable extracted text and flag uncertain note detection.

Plan for a later addition allowing generated audio to be saved permanently on the site in selected circumstances, such as an on-demand audio version of a white paper. This is explicitly outside the first release. All authorized editors and administrators may save permanently when this capability is added; Guest authors remain excluded. Its publication workflow remains unconfirmed.

**Why:** The user explicitly requested this exception to automatic expiry, deferred implementation, and selected all authorized editors and administrators.

**How to apply:** Apply automatic expiry to every first-release job. Preserve a future explicit promotion path without implementing permanent saving now or assuming permission to publish manuscripts or audio.
