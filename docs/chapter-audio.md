# Chapter Audio — development release

## Scope and access

Dev/test only at `/admin/chapter-audio`, under the CMS Library group. The
production route, API, schema initialization, and queue worker are disabled.
Nothing here publishes content, pushes GitHub changes, or modifies production.

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

The existing object-storage client stores chapter content under a dedicated
`synozur-private-chapter-audio/dev/` bucket namespace, separate from the public
search roots and the generic `/objects` resolution root. Startup checks reject
overlapping namespaces. All reads go through authenticated chapter endpoints,
with `private, no-store` and `noindex` headers. Keys are not sent to browsers.
No manuscripts, original uploads, or generated audio enter GitHub or
`attached_assets`. This adds new private files; it does not migrate existing
GCS/SharePoint media or change the site's active storage backend.

## Queue and operations

The database stores job metadata and expiring worker leases, not manuscript
bytes. A worker polls every three seconds. Claiming uses PostgreSQL
`FOR UPDATE SKIP LOCKED`; leases are renewed every 20 seconds and expire after
five minutes. Completed section files are reused after restart/retry.
Cancellation prevents final publication; retries never extend expiry.
The queue accepts at most ten pending jobs at submission. Rate limits also
apply to extraction, submissions/actions, and sample generation.

The dev API process runs the worker. Browser closure is safe, but rendering
pauses when the dev server is stopped and resumes after restart/lease expiry.
Before production, provision an execution arrangement that stays available for
long jobs and scheduled cleanup; do not assume an idle web process runs forever.

Azure Speech and private object storage must already be configured. Azure
credentials are accessed only by the server. No alternate-provider fallback.
`ffmpeg-static` must have its install script run so its binary exists. The API
build externalizes it because its binary is resolved relative to its package.
Missing encoder/storage/speech configuration disables new rendering.
Sample/provider failures are explicit and never log manuscript/provider bodies.

## Verification and production gate

Focused tests: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/chapterAudio/chapterAudio.test.ts`

Before approving production: resolve Git reconciliation separately; verify role
mapping, configured-region voice availability, storage isolation and deletion,
real chapter timing/cost, encoder packaging, and worker/cleanup hosting. Replace
the explicit development-only switches with an approved feature-enable plan and
review additive schema setup. No production enablement is implicit in this work.
