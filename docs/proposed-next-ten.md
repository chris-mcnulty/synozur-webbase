# Proposed: Next Ten Enhancements

> Prepared May 13, 2026. Source: cross-read of `backlog.md` (product),
> `BACKLOG.md` (technical debt), the launch-readiness Tier 1-3 list,
> the Galaxy / OAuth / quality-gates follow-up sections, and the
> current `artifacts/` and `lib/` layout.

## Selection rules

- Skip already-shipped tasks (#56–#170 are largely closed in May 2026).
- Skip pure ops / data-backfill items (L1, L3, L5, L6, L7) — those
  belong on the launch-readiness checklist, not the engineering queue.
- Favor work that **unblocks shipped-but-isolated systems** (OAuth →
  Galaxy → Partner Portal, quality-gates warn-mode → block-mode, the
  CWV / axe loop).
- Favor work that **finishes half-migrations** already counted as
  technical debt (Asset Library, Workshops schema parity).
- Include two pure product-value features that have no dependencies
  on the above (#83, #85) so the queue isn't 100% plumbing.

Each item lists the **primary source** in the existing backlogs so the
spec body is not duplicated here.

---

## 1. Per-OAuth-client role catalog + bindings

**Source:** `BACKLOG.md` → "OAuth provider follow-ups" item #1.

**Why next:** Marked *"required before #135 ships"*; #135 Galaxy v0
*has* shipped, so the rule is already overdue. Until this lands, the
`roles` claim on every access token is the empty array and downstream
apps cannot make per-tenant authorization decisions without re-querying
the api-server. Blocks #129 (cross-app switcher), #141 (partner portal),
and any future remote-app admin UI that needs role mutation.

**Scope (one PR):** add `oauth_client_roles` and
`oauth_client_role_bindings` tables; populate the `roles[]` claim from
the bindings; admin UI under `/admin/access/oauth-clients/:id/roles`;
the privileged `roles.manage:tenant` scope; backfill a single
`platform-admin` role per existing client so the migration is non-empty.

**Out of scope:** SCIM provisioning, custom claim shapes per client.

---

## 2. OAuth standards completeness: introspection, revocation, signing-key rotation

**Source:** `BACKLOG.md` → "OAuth provider follow-ups" items #2, #3, #4.

**Why next:** Three small RFC-shaped surfaces that together close the
operational gap on the OAuth provider. Resource servers that don't want
to re-implement JWKS validation need `/oauth/introspect`; downstream
apps that want a real sign-out (instead of waiting for refresh-token
expiry) need `/oauth/revoke`; an unattended rotation cron eliminates
the "active key sat for a year" risk that an audit will flag the moment
external pen-testers reach this surface.

**Scope (one PR):**
- `POST /oauth/introspect` (RFC 7662) with the spec-mandated response
  shape; bearer-auth via the client's `client_secret` or PKCE proof.
- `POST /oauth/revoke` (RFC 7009) for both `refresh_token` and
  `access_token` hints; idempotent.
- Scheduler cron in `lib/scheduler.ts` that rotates the active
  `oauth_signing_keys` row every N days (default 90, admin-configurable),
  retires keys older than the longest token lifetime (refresh-token TTL
  + grace), and emits `oauth.signing_key.rotated` audit events.

**Out of scope:** key escrow, mTLS client auth, dynamic client
registration (RFC 7591).

---

## 3. Publish `@synozur/auth-sdk` for downstream OAuth consumers

**Source:** `BACKLOG.md` → "OAuth provider follow-ups" item #5;
`lib/auth-sdk` already exists in the monorepo.

**Why next:** Galaxy is already consuming `@workspace/auth-sdk`
in-monorepo (see `#128` shipped note). The package is unproven outside
the workspace and has no public versioning story, so any external
Synozur app that wants to integrate has to copy code instead of `pnpm
add`. Publishing pairs naturally with #129 (cross-app switcher) which
will be the second SDK consumer.

**Scope (one PR):**
- Lock the public API of `lib/auth-sdk` (PKCE client, `requireOidcUser`
  Express middleware, `useSynozurAuth()` React hook).
- Wire `changesets` (already used elsewhere in the workspace) so the
  package gets a semver release on every merged change.
- Add a worked `examples/auth-sdk-quickstart/` consuming app inside the
  monorepo so the README's "wire OAuth in 10 lines" claim is testable.
- CI: a `verify:auth-sdk` job that builds the example app against the
  pre-publish bundle.

**Out of scope:** publishing to a public registry (decide
publish-target with leadership before flipping the switch — likely a
private GitHub Packages registry until #141 partner portal needs it
broader).

---

## 4. `@axe-core/playwright` results → `publish_blocks`

**Source:** `BACKLOG.md` → "Quality gates" item #5 **and** "SEO &
web-platform debt" item #3 (cross-referenced; same engineering work).

**Why next:** Listed in *two* separate follow-up sections, which is a
strong "still unaddressed" signal. The CI workflow already runs axe
and fails the build on regressions, but the violations never land in
`publish_blocks` — so editors only see them in CI logs they don't read.
Fixing this turns axe from a developer-only gate into the same surface
as the rest of the quality-gates infrastructure (#142).

**Scope (one PR):**
- New `POST /cms/quality/axe-report` endpoint (admin-or-CI-token auth)
  that accepts a normalized `{ route, violations[] }` payload and
  upserts one `publish_blocks` row per `serious|critical` violation,
  keyed on the artifact's canonical URL.
- `pnpm run sync:axe` script invoked at the end of the Playwright run
  in `.github/workflows/quality.yml`; uploads
  `axe-violations.json` as a workflow artifact and posts the same JSON
  to the new endpoint when an `AXE_REPORT_TOKEN` secret is configured.
- Severity stays `warn` for the first 14 days (matches the existing
  "still warming up data" rule for CWV).

**Out of scope:** a per-rule ignore list (the existing axe config
already supports that); fixing the violations themselves.

---

## 5. Quality gates: CWV severity auto-flip + hard-reject publish guards

**Source:** `backlog.md` → L17; `BACKLOG.md` → "Quality gates" items #3
and #4.

**Why next:** Items #1 and #2 (publish-blocks banner on remaining
artifact pages, daily cron) shipped during the launch-readiness pass.
The publish gate has been in warn-mode since April 2026 — long enough
that "give the team time to clear the backlog" no longer holds.
Flipping severity automatically (rather than asking an admin to do it
by hand) is the safe path; pairing it with the route-guard hard-reject
finally gives `publish_blocks` teeth.

**Scope (one PR):**
- Add `firstSeenAt` to the publish-block scan (or derive from
  `created_at`) and a daily worker step that auto-flips CWV-rule rows
  to `severity = 'block'` when p75 has been over threshold for ≥ 14
  days. Alt-text rules flip immediately (no warmup story).
- Publish mutation in each artifact admin route returns structured 422
  with the block list when any `severity = 'block'` row exists for the
  artifact (or its canonical URL). Admin form surfaces it inline.
- Override path (`DELETE /cms/publish-blocks/:id` + audit-logged note)
  unchanged.

**Out of scope:** retroactively blocking already-published artifacts
(blocks apply to *publish mutations*, not to live content).

---

## 6. Asset Library consolidation — finish the migration

**Source:** `BACKLOG.md` → "Asset Library consolidation" items #2–#6.

**Why next:** Step #1 (the 15 admin editors migrated to
`MediaPickerModal`) shipped in PR #55. Steps #2–#6 are the cleanup tail
that keeps the legacy `assets` table alive purely as dead weight: an
integer-id table, a duplicate enum (`ASSET_CATEGORIES`), a discriminator
on `LibraryAssetItem`, and a redirect-only `/insights/media` page. Each
day this drags adds more refactor surface for any future schema work.

**Scope (one PR):**
1. Add `events.image_media_id uuid`; backfill from the assets→media
   map; update `routes/events.ts` batch loader; drop `image_asset_id`.
2. Rewire `seedHomepageAssets.ts` and
   `backfillCollateralHeroAssets.ts` to write to `mediaTable`; drop the
   legacy `assets` table and `/assets` routes.
3. Remove `ASSET_CATEGORIES` / `ASSET_CATEGORY_LABELS` /
   `isAssetCategory` from `lib/api-zod/src/constants.ts`; drop
   `assets.category` (the column survives only on the dropped table,
   so this is a no-op if (2) ran first).
4. Drop the `source` discriminator from `LibraryAssetItem`; simplify
   `/cms/library/assets` to a straight `media` query.
5. Delete `pages/admin/insights/media.tsx` (the redirect stub) and any
   server-side route that only existed to back the redirect.

**Out of scope:** schema changes to `media` itself.

---

## 7. Workshops schema parity

**Source:** `BACKLOG.md` → "Workshops schema parity" items #1–#3.

**Why next:** Workshops is the only published artifact kind that still
uses a `seo` JSONB instead of flat `seo_title` / `seo_description` /
`og_image` columns, and the only kind with `active` + `deletedAt`
instead of the `status` / `published_at` / `unpublished_at` triple.
That bespoke shape forces a `case "workshop"` read-modify-write branch
in `lib/seoAudit.ts:applyAutofill` and means workshops can't use the
sitemap's standard publish predicate. The total diff is small but the
parity payoff is large.

**Scope (one PR):**
- Migration: split `workshops.seo` into `seo_title` / `seo_description`
  / `og_image` columns; backfill from JSONB; drop JSONB.
- Migration: add `status` / `published_at` / `unpublished_at`; backfill
  `status='published'` for `active=true` rows; deprecate `active` reads
  in `routes/workshops.ts` and `lib/seoAudit.ts:auditWorkshops`.
- Replace `artifacts/api-server/src/scripts/data/workshops.json` with a
  `pnpm db:dump-seed workshops` helper mirroring the collateral path.

**Out of scope:** changing the public workshop URL slug.

---

## 8. Cross-app switcher for signed-in users (#129)

**Source:** `backlog.md` → `#129`.

**Why next:** Direct beneficiary of the shipped #128 OAuth provider
and #225 client-org admin. The infrastructure is in place; what's
missing is the visible UI surface that proves to signed-in users that
Synozur is "one logged-in experience" across the marketing site,
Galaxy, Constellation, Vega, and future apps. Without this, the OAuth
provider is invisible to the customers paying for it.

**Scope (one PR):**
- React hook `useAppSwitcher()` (lives in `@synozur/auth-sdk` per #3
  above) that lists every registered OAuth client the current user has
  access to, deduped by the new role bindings from #1.
- Header component on the marketing site, Galaxy, and the admin shell
  that renders the list as a popover with one-click navigation.
- Single-sign-on hop: the switcher target gets the user to the
  destination app via the existing `/oauth/authorize` flow with
  `prompt=none` so the SSO is silent unless the session has expired.
- Telemetry: `app_switcher.opened` and `app_switcher.navigated`
  events to dataLayer (GA4) and `audit_log`.

**Out of scope:** per-app pinning, "recently used" sorting (cosmetic;
ship after we have usage data).

---

## 9. Gated download CTA for white papers (#83)

**Source:** `backlog.md` → `#83`.

**Why next:** Highest-ROI item in the still-open product backlog.
White paper detail pages currently offer a plain download button — no
lead capture, no email, no follow-up nurture. Every white-paper
download is sales pipeline left on the floor. The plumbing is already
in place: the `submissions` table backs every other form, Resend / SendGrid
handles the email send, and the signed-URL pattern from
`lib/unsubscribeToken.ts` is the right primitive for the time-limited
download link.

**Scope (one PR):**
- New `requireEmailToDownload: boolean` column on `collateral` (or
  `white_papers`) plus an admin toggle on the collateral editor.
- Gated downloads: visitor submits name + email → `submissions` row →
  email contains a single-use signed download link with a 7-day TTL.
- Non-gated rows preserve the existing direct-download behavior with
  no UX change.
- HubSpot timeline event `synozur_whitepaper_downloaded` emitted on
  link click (pairs with the existing #131 contact-stitching path).

**Out of scope:** progressive profiling, "gate after the third
download" rules (decide once we have a quarter of conversion data).

---

## 10. Upcoming-webinar registration rail (#85)

**Source:** `backlog.md` → `#85`.

**Why next:** Same lead-capture rationale as #9 above, for the other
top-of-funnel content type. Today every webinar in the collateral
library is treated as a past on-demand recording, even when it's
actually a future event — the registration intent is invisible. The
fix is a small lifecycle addition to `collateral` (a `scheduled_at`
column and optional `registration_url`) plus a new "Upcoming" rail on
the webinar index.

**Scope (one PR):**
- `collateral.scheduled_at timestamptz null` + `registration_url text
  null`; idempotent migration.
- Public detail page renders the registration CTA (and a date / time
  block) when `scheduled_at > now()`; reverts to the on-demand video
  player automatically once `scheduled_at` is in the past.
- Webinar index page gains an "Upcoming" section above the on-demand
  grid, sorted by `scheduled_at asc`.
- Inline name / email form (when no external `registration_url`):
  creates a `submissions` row, sends a confirmation email with an
  `.ics` attachment via the existing email transport.

**Out of scope:** capacity caps, waitlists, calendar two-way sync
(those are the Bookings-depth items in the Wix-parity section of
`BACKLOG.md` and are an order of magnitude larger).

---

## Sequencing

Recommended pairing:

- **Sprint A** (auth foundation, unblocks more work): items 1, 2, 3
  ship in that order; 8 lands at the end of the sprint as the visible
  payoff.
- **Sprint B** (quality / debt): items 4, 5, 6, 7 in parallel — each
  is one engineer-week and they touch independent code paths.
- **Sprint C** (lead-capture): items 9 and 10 — independent of A/B,
  schedule whenever a marketing-engineering pair has bandwidth.

## What was intentionally not in this list

- **Strategic roadmap items** (interactive maturity assessment, Astra
  AI concierge, programmatic case-study drafts from Constellation):
  each is a quarter+ of engineering — they belong on a roadmap
  discussion, not the next-ten queue.
- **Ops-only launch-readiness items** (L1, L3, L5, L6, L7): runbook
  work, not engineering.
- **#139 internationalization foundation**: real value but the
  smallest meaningful slice is still ~6 engineer-weeks. Re-evaluate
  after the first non-English procurement deal materializes.
- **#132 SendGrid marketing tier**: #220 already moved transactional
  sends to SendGrid; the marketing-tier provider abstraction can wait
  until newsletter volume actually demands it.
- **#160 Search Console indexing dashboard**: pairs naturally with the
  L2 ops work; if launch-readiness ships L2 in the next sprint, fold
  #160 into the same PR rather than scheduling separately.
- **Short-link root path takeover** (`BACKLOG.md` tail): the interim
  workaround is stable and the proper fix is a medium-complexity
  infra change with zero user-visible delta — keep it queued behind
  Wix-parity until there's a forcing function.
