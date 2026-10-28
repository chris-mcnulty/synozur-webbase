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

Use the existing deployment type and SharePoint Embedded storage layer for
production integration. The user states that the public website is ping-tested
every five minutes and does not want its deployment type changed.

**Why:** The user explicitly rejected introducing a different deployment type
or treating existing storage and schema-publication facilities as missing
infrastructure.

**How to apply:** Integrate Chapter Audio into the site's established storage
and publishing paths, preserving private access and interruption recovery.
Do not propose replacing hosting or provisioning a second storage system.

Private narration must not be registered as ordinary public media merely to
reuse the site's file-serving routes. SPE orphan reconciliation must account
for private consumers as well as the public media library.

**Why:** The chapter access boundary is stricter than the site's existing
generic storage endpoints. A media-only orphan definition would mistake
legitimate private files for abandoned uploads and delete them.

**How to apply:** Keep narration delivery behind editorial authorization and
include durable private references whenever changing shared storage cleanup.

Do not treat Azure's regional voice catalog as conclusive evidence that a
documented Dragon HD voice is unavailable.

**Why:** The configured region's catalog omitted the generally available
Andrew 2 and Emma 2 voices even though both successfully synthesized audio.

**How to apply:** Use Microsoft's current model documentation and a short,
metered synthesis check before excluding a documented voice missing from the
catalog. Keep preview and different-model voices outside the approved scope.

Chapter Audio uploads are extraction only, not submissions; never tell a user
their chapter is queued until the server has accepted a create request.

**Why:** A production visitor thought a chapter had been submitted, but
available production evidence showed extraction and an estimate, with no
corresponding job-creation request. A fleeting toast and a job list below a
long form were insufficient confirmation.

**How to apply:** Keep the submission action explicit and show durable,
server-backed queue/progress/error status near the top of the editorial page.
