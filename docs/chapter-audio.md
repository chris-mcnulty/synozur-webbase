# Chapter Audio

## Scope and access

Available at `/admin/chapter-audio`, under the CMS Library group, including
production builds. The API initializes its additive schema at startup and runs
the queue worker in the existing API service. Deploying the code is separate
from publishing any audio: this feature does not publish content or push GitHub.

Only signed-in `admin`, `site_admin`, `editor`, and `content_author` users may
access the feature. Legacy restricted `author` and `contributor` roles, portal
users, anonymous visitors, and API-key callers are denied. Authorization is
checked on extraction, job actions, voice samples, playback, and downloads.
All authorized users see the shared history.

## Inputs, audio and retention

Paste text or upload UTF-8 `.txt`, Markdown `.md`, or Word `.docx` (not legacy
`.doc`). Uploads are capped at 10 MB and Word zip expansion is bounded. The
uploaded original is processed in memory, not retained. Reviewable narration
and optional chapter notes are extracted; no language model rewrites content.
Footnotes default to omitted; users may append notes, announced as "Chapter notes."
The total spoken text, including this announcement, is capped at 10,000 words.

Azure Dragon HD English voices render bounded sentence/paragraph sections.
MP3 is 24 kHz, mono, 96 kbit/s. Standard voice samples are generated on demand
and cached separately; no manuscript samples are used.

Chapter Audio offers 15 generally available English single-narrator Dragon HD
voices, independently of the Briefing Podcast selection: Adam, Alloy, Andrew,
Andrew 2 (Conversational), Aria, Ava, Brian, Davis, Emma, Emma 2 (Conversational),
Jenny, Nova, Phoebe, Serena, and Steffan. Preview, multi-talker, and Dragon HD
Omni models are excluded. Every option uses the same standard-sample control.

Every job expires 30 days after submission, even after retries. All content
access is refused at expiry. Cleanup retries deletion of the source narration,
section MP3s, and final MP3. Expired rows retain minimal operational metadata;
their titles/creator labels are cleared after successful content cleanup.
Delete marks a job inaccessible immediately, and retries storage removal.
Active rendering may take up to the outstanding section/encoder timeout to stop.

Permanent saving, public playback/publication, email delivery, translation,
whole-book rendering, and AI rewriting are not part of this release.
Permanent promotion is reserved for later editorial work, not an expiry bypass.

## Private storage

Chapter content uses the existing SharePoint Embedded service, in its dedicated
`chapter-audio` folder. The environment's existing dev/prod container setting
selects the write destination. A private database registry retains both item
and original container IDs, so container rotation does not break existing files.
These records never enter the public media catalog. Generic public storage
routes cannot resolve them; authenticated chapter endpoints supply
`private, no-store` and `noindex` headers. SharePoint references are not sent to
browsers. The SPE orphan reconciler preserves files in this registry.
No manuscripts, original uploads, or generated audio enter GitHub or
`attached_assets`. There is no GCS write or fallback in Chapter Audio.

## Queue and operations

The database stores job metadata and expiring worker leases, not manuscript
bytes. A worker polls every three seconds. Claiming uses PostgreSQL
`FOR UPDATE SKIP LOCKED`; leases are renewed every 20 seconds and expire after
five minutes. Completed section files are reused after restart/retry.
Cancellation prevents final publication; retries never extend expiry.
The queue accepts at most ten pending jobs at submission. Rate limits also
apply to extraction, submissions/actions, and sample generation.

The existing API process runs the worker. Browser closure is safe, but rendering
pauses when the service is stopped and resumes after restart/lease expiry.
Keep the existing deployment type and the site's five-minute ping checks.

Azure Speech and private object storage must already be configured. Azure
credentials are accessed only by the server. No alternate-provider fallback.
`ffmpeg-static` must have its install script run so its binary exists. The API
build externalizes it because its binary is resolved relative to its package.
Missing encoder/storage/speech configuration disables new rendering.
Sample/provider failures are explicit and never log manuscript/provider bodies.

## Verification and production gate

Focused tests: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/chapterAudio/chapterAudio.test.ts`

## Speech cost visibility

Before generation, a debounced server estimate uses the same reviewed narration,
optional chapter notes, section boundaries and SSML as the renderer. It counts
Unicode code points, whitespace, escaped XML and pronunciation markup, excluding
the speak/voice wrappers; CJK ideographs are weighted twice. This follows
[Microsoft's billable-character guidance](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech#billable-characters)
but remains an estimate, not Azure's authoritative meter.

Only `admin` and `site_admin` can save manual rates or view the monthly spending
summary. An empty rate table is initialized once with the user-approved estimate
of USD 15 per million characters; this is not a verified invoiced rate.
Existing administrator rates are not overwritten. Rates have an effective date.
Missing rates produce **Cost estimate unavailable**, not zero.
Saving creates a new version. Initial job estimates and every request's rate
snapshot are immutable: later settings never reprice historical usage. Future
effective dates are supported; historical unpriced usage stays unpriced.

A durable metadata-only intent is recorded before every paid speech request,
including uncached standard samples. Recording failure prevents that request.
Each request records its own character count and outcome. Successful responses
are estimated as processed even if receiving/assembling audio later fails.
Authentication, missing-resource and throttling rejections are separated.
Other provider failures, timeouts and unfinished intents remain uncertain:
Azure may have processed them. Their potential cost is included in totals and
explicitly identified as a subset, not added twice. A crash before dispatch can
therefore conservatively overestimate usage. Retries create additional entries.
Cached sample reads create no new synthesis entry; reused chapter sections are
recorded as zero-character reuse events. Chapter usage is attributed to its
submitting user (including retries); sample generation to the initiating user.

The administrator report uses UTC calendar months, separates currencies, and
shows attempts, chapter activity, retries, samples, uncertain/unpriced usage,
and grouping by user/voice. Coverage begins when metering is initialized:
pre-existing jobs are labelled incomplete rather than inventing past usage.
No Azure invoice integration, budgets, hard spending limits or hosting/storage
cost estimates are implemented.

Minimal usage metadata (IDs, user label, voice, counts, outcomes and rate
snapshots) remains after job/audio deletion so monthly totals cannot disappear.
It contains no manuscript, SSML, provider body or chapter title. Original
manuscript/audio retention and private access are unchanged.

Cost-focused checks:
`pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/chapterAudio/costMath.test.ts src/routes/chapterAudio.test.ts`

## Publishing

Use the existing publication process and deployment type. The shared database
schema includes chapter jobs, private SPE file references, rate versions, and
the usage ledger. API startup also idempotently creates these additive tables
and initializes the USD 15 estimate only if no rate exists. Production uses its
own SPE container setting and existing Azure Speech credentials.

No manuscript, generated audio, dev job history, or production content/settings
rows need to be copied between databases. Publishing this code enables the
authorized CMS route and worker; it does not expose public audio. Verify a short
chapter and its deletion after publication. A full 10,000-word timing benchmark
has not been measured; it is not a promised completion time.
