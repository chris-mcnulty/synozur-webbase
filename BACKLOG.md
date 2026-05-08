# Backlog / Technical Debt

## Asset Library consolidation (follow-up to asset-library admin UI)

Context: the April 2026 "Asset Library admin" work introduced the editable
`asset_categories` table and a unified admin page at `/admin/library/assets`,
but intentionally deferred the full physical merge of the legacy `assets`
table into `media` to keep the diff reviewable and protect the 15 admin
editors that still reference the legacy asset picker.

Follow-up items, in recommended order:

1. ~~**Migrate 15 admin editors from `AssetLibraryModal` (integer asset IDs) to a
   unified `MediaPickerModal` that reads from `/cms/media` (UUID media IDs).**~~
   **Shipped in PR #55** — all seven listed admin editors
   (`site-settings.tsx`, `seo.tsx`, `collateral-edit.tsx`, `video-edit.tsx`,
   `white-paper-edit.tsx`, `workshop-edit.tsx`, `people/event-form.tsx`) now
   import `MediaPickerModal` and persist `*MediaId` UUID columns. Legacy
   `AssetLibraryModal` is no longer imported by admin pages; remaining
   callers are scripts/backfills referenced in step 3 below.

2. **Change `events.image_asset_id` (integer) to `events.image_media_id`
   (uuid).** No FK constraint exists today on `image_asset_id`; the migration
   must: add `image_media_id uuid`, backfill using the assets→media map,
   update `routes/events.ts` batch loader, drop the old column.

3. **Drop the legacy `assets` table and `/assets` routes.** Prerequisite: all
   callers above migrated; verify no lingering references in
   `artifacts/api-server/src/{routes,lib,scripts}` or in seeders
   (`seedHomepageAssets.ts`, `backfillCollateralHeroAssets.ts` reference
   `assetsTable` and will need rewiring to `mediaTable`).

4. **Remove the legacy `ASSET_CATEGORIES` / `ASSET_CATEGORY_LABELS` /
   `isAssetCategory` exports from `lib/api-zod/src/constants.ts`.** The
   `assets.category` (slug string) column can also be dropped at this point.

5. **Remove the `source` discriminator from `LibraryAssetItem` and
   `/cms/library/assets`** — once `assets` is gone, the unified list reduces
   to a straight query on `media`.

6. **Remove the deprecated admin page `pages/admin/insights/media.tsx`** (the
   unified `/library/assets` page supersedes it; `/insights/media` currently
   redirects).

Owner/tracking: file a ticket referencing this section once prioritized.

---

## Clerk removal cleanup (follow-up to native Entra OIDC)

Context: PR #45 (April 2026) replaced Clerk with a native Entra OIDC client
+ cookie-bound server-side sessions, and dropped `users.clerk_user_id` in
favor of `users.external_subject` / `users.auth_provider`. The cutover was
staged so production stays runnable with a stale-but-working Clerk
deployment until env + DB are migrated. The cleanup tail below is small
but spans environments.

Follow-up items, in recommended order:

1. ~~**Apply the schema migration in every environment.**~~ **Shipped (May 2026
   verification).** `lib/db/src/schema/users.ts` no longer carries
   `clerk_user_id` and now defines `external_subject`, `auth_provider`,
   `last_sign_in_at`. The `sessions` and `auth_pending_states` tables are
   present in the schema. The OIDC sign-in round-trip should still be
   spot-checked per environment after the next `pnpm --filter
   @workspace/db run push` so dev → staging → production stay in sync.

2. **Provision the Entra app registration per environment** (per
   `docs/integrations.md`): redirect URIs, `User.Read` delegated +
   `GroupMember.Read.All` application permissions with admin consent, and
   the `synozur.com` domain claim hint. Set `ENTRA_TENANT_ID`,
   `ENTRA_APP_CLIENT_ID`, `AUTH_REDIRECT_URI`, and (if using app-only
   Graph) `ENTRA_APP_CLIENT_SECRET` in each env's secret store.

3. **Remove leftover Clerk env vars** from every deployment target:
   `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`,
   `VITE_CLERK_PROXY_URL`. They're now ignored by the code path but stay in
   secret stores until manually purged.

4. **Decommission the Clerk tenant** once production has been on the
   native flow for ≥30 days. Keep an exported user list around for the
   audit trail; cancel the subscription afterwards.

5. ~~**Pre-link directory metadata for imported-author rows.**~~
   **Shipped (May 2026).**
   `artifacts/api-server/src/scripts/linkImportedAuthors.ts` resolves
   `auth_provider="imported"` rows against Microsoft Graph
   (`/users?$filter=mail eq '…' or userPrincipalName eq '…'`) and
   populates `entra_object_id` + `entra_tenant_id` in bulk so admin
   queries can show the directory linkage before first sign-in.
   `external_subject` is intentionally NOT touched: for Entra users
   that column holds the OIDC `sub` claim, not the directory object
   id, and pre-populating it would cause the callback's
   `(auth_provider, external_subject)` lookup to miss the row on
   first sign-in. Leaving `auth_provider = 'imported'` keeps the row
   visible to the callback's email-fallback branch in
   `routes/auth.ts`, which writes the real `sub` to
   `external_subject` at sign-in time and flips the provider to
   `entra`. Defaults to dry-run; pass `--apply` to write. Requires
   `ENTRA_TENANT_ID` + `ENTRA_APP_CLIENT_ID` + `ENTRA_APP_CLIENT_SECRET`
   with `User.Read.All` application permission and admin consent.

6. ~~**Remove the `/sign-up` redirect stub.**~~ **Skipped — superseded.**
   `pages/sign-up.tsx` is no longer a redirect stub: it's the active
   local email/password registration surface, posting to
   `/api/auth/register` and running the email-verification flow. Removal
   is no longer appropriate; the BACKLOG description was stale.

7. ~~**Add a `provider` filter to the `/admin/access/users` table.**~~
   **Shipped (May 2026).** `pages/admin/access/users.tsx` now exposes a
   provider Select (`all` / `entra` / `imported` / `local` / `unknown`)
   with per-bucket counts; each user row also surfaces a provider Badge
   so the source IdP is visible inline. `data-testid="provider-filter"`
   for the e2e harness.

8. ~~**Delete the `last_sso_provider` column from `users`.**~~
   **Shipped (May 2026).** Schema definition removed
   (`lib/db/src/schema/users.ts`); writes removed from
   `lib/entra.ts:applyEntraSignIn` and `routes/auth.ts` (insert + update
   branches); migration step 38 (`ALTER TABLE users DROP COLUMN IF EXISTS
   last_sso_provider`) added so existing environments drop the column on
   the next server boot. `auth_provider` is the canonical IdP signal.

9. ~~**Add a Playwright sign-in smoke test.**~~ **Scaffolding shipped
   (May 2026).** `artifacts/synozur/tests/sign-in.spec.ts` covers two
   tiers: (a) always-on render assertions on `/sign-in` plus a verified
   redirect from the Entra button to `login.microsoftonline.com`
   (with `client_id` and `code_challenge` query params asserted), and
   (b) a full `/sign-in → Entra → /callback → /api/auth/me` round-trip
   gated on `E2E_ENTRA_TEST_USER_EMAIL` + `E2E_ENTRA_TEST_USER_PASSWORD`
   so CI doesn't require an Entra test tenant by default. Provisioning
   the test-tenant credential is the remaining gap before the full
   round-trip runs in CI.

10. ~~**Strip the `dev-login` escape hatch.**~~ **Shipped (May 2026).**
    Removed `POST /api/auth/dev-login` from `routes/auth.ts` and the
    `ALLOW_DEV_LOGIN` env-var rows from `admin-guide.md` and
    `docs/integrations.md`. Local dev now uses the same email/password
    + email-verification flow as production; Entra sign-in covers the
    Synozur staff path.

Owner/tracking: file a ticket referencing this section once #45 lands.

---

## Quality gates: warn-mode → hard-mode (follow-up to #142)

Context: the April 2026 quality-gates work shipped four phases of #142 in
warn-mode — `media.alt_text` is required, the `RichTextEditor`
surfaces heading-order issues, real-user CWV samples land in
`cwv_samples`, the admin Site Health dashboard renders the aggregate
view, and `publish_blocks` rows surface inline on the collateral edit
page. None of this rejects a publish mutation today; the team needs
time to clear the inherited backlog before the gate becomes a hard
stop.

Follow-up items, in recommended order:

1. **Surface `<PublishBlocksBanner>` on the remaining artifact edit
   pages** — posts, videos, white papers, workshops, case studies,
   models, polaris episodes, applications. Same component as the
   collateral edit page; each page just needs to pass its `id` and
   the `cmsListPublishBlocks` filter that matches its `artifactKind`
   convention. Keep the route-level join (CWV blocks keyed on the
   row's canonical URL) so a `/library/foo` LCP regression surfaces
   on the article that publishes there.

2. **Run the publish-block scan on a daily cron** rather than only
   on admin demand. A small worker in `artifacts/api-server/src/lib/`
   that calls `scanPublishBlocks()` once a day is enough; reuse the
   existing scheduler scaffold from `lib/scheduler.ts`. Surface the
   last-run-at on the Site Health page header.

3. **Flip `severity` to `block` for CWV rules whose p75 exceeds
   threshold for ≥ 14 days.** Add a `firstSeenAt` derivative to the
   scan (or use the existing `created_at` on the row) and bump the
   severity automatically when the underlying signal has been bad
   long enough that "still warming up data" is no longer a credible
   excuse. Alt-text rules can flip to `block` immediately — there's
   no warmup story for those.

4. **Add the hard-reject route guards.** When a `severity = 'block'`
   row exists for the artifact (or its route), the publish mutation
   in the matching admin route returns a structured 422 with the
   block list, and the admin form surfaces it inline as a validation
   error rather than a soft warning. The override path
   (`DELETE /cms/publish-blocks/:id` + audit-logged note) stays the
   same.

5. **Wire `@axe-core/playwright` results into the database.** Today
   axe runs only at CI time and fails the build, but the `serious`+
   violation set never lands in `publish_blocks`. Either teach
   `scanPublishBlocks` to read from a CI-uploaded artifact, or post
   the failing rules to a new `POST /cms/quality/axe-report`
   endpoint at the end of the Playwright run. Pairs naturally with
   the e2e-in-CI plumbing in #142 Phase C.

6. **Drop the legacy `collateral.download_url` column** once every
   collateral consumer reads from `collateral_resources` (#122
   shipped the migration but kept the column as a read-only mirror
   for back-compat). Remove the mirror writeback in
   `routes/collateralResources.ts:refreshDownloadUrlMirror` at the
   same time.

Owner/tracking: file a ticket referencing this section once warn-mode
metrics on the dev environment are clean (or once the team decides
the residual warnings are accepted).

---

## OAuth provider follow-ups (follow-up to #128)

Context: PR for #128 lands the OAuth provider in two phases on a single
branch. Phase A adds the schema, signing-key bootstrap, and admin CRUD;
Phase B adds the public OAuth surface (authorize / token / userinfo /
JWKS / discovery) and the consent screen. Tokens carry a `roles: []`
claim that's empty until per-OAuth-client roles ship as the follow-up
below.

Follow-up items, in recommended order:

1. **Per-OAuth-client role catalog + bindings.** Today the platform has
   one global `roles` table; once Galaxy (#135) and Partner Portal
   (#141) land, each remote app needs its own role hierarchy
   (platform-admin / tenant-admin / user) scoped optionally to a
   `client_organizations` row. Add tables `oauth_client_roles`
   (`client_id`, `name`, `description`, `scope_level: 'platform' |
   'tenant'`) and `oauth_client_role_bindings` (`client_id`, `user_id`,
   `role_id`, nullable `client_organization_id`). Populate the empty
   `roles` claim on access tokens from these bindings. Add admin UI at
   `/admin/access/oauth-clients/:id/roles` and a privileged scope
   `roles.manage:tenant` so the remote app's own admin UI can manage
   its tenant's bindings. **Required before #135 ships.**

2. **Token-introspection endpoint** (`POST /oauth/introspect`, RFC 7662).
   Lets resource servers validate opaque-or-JWT bearer tokens out-of-band
   without re-implementing JWKS + claim checks. Useful for the
   `@synozur/auth-sdk` helper package.

3. **Token-revocation endpoint** (`POST /oauth/revoke`, RFC 7009). Today
   refresh tokens are revoked admin-side via the client revoke action;
   a standard endpoint lets a downstream app revoke on its own (e.g.
   when the user signs out of Galaxy).

4. **Signing-key rotation cron.** Active key stays put until an admin
   triggers rotation; a cron job that rotates every N days and retires
   keys older than the longest token lifetime would close the
   operational gap.

5. **Publish `@synozur/auth-sdk`.** Per the #128 task description: a
   small helper package in `lib/` that downstream apps import to wire
   up the OAuth flow in a handful of lines. Wraps the discovery
   document, JWKS verification, PKCE, and a React hook for the cross-
   app switcher (#129).

Owner/tracking: file a ticket referencing this section once #128 lands
and the first downstream consumer (#135 Galaxy) starts integrating.

---

## Workshops schema parity (follow-up to #95)

Context: #95 moved workshops from a static TS data file into the
`workshops` table and wired the table into the public pages, the
sitemap, and the SEO audit. The audit integration works but had to
special-case workshops because the table stores SEO copy in a
`seo` JSONB (`{ title, description }`) rather than the flat
`seo_title` / `seo_description` / `og_image` columns the other
artifact tables use, and lifecycle is just `active` + `deletedAt`
rather than the `status` / `published_at` / `unpublished_at` triple.

Follow-up items, in recommended order:

1. **Flatten the `seo` JSONB into `seo_title` / `seo_description` /
   `og_image` columns** on `workshops`, with a migration that splits
   existing rows. Drop the JSONB after the backfill verifies. This
   removes the bespoke read-modify-write branch in
   `lib/seoAudit.ts:applyAutofill` (the `case "workshop"` block) and
   lets workshops use the same flat-column update path as the other
   kinds.

2. **Add `status` / `published_at` / `unpublished_at` to `workshops`**
   so the publish/unpublish gating used by services / solutions /
   applications / case studies / models works for workshops too.
   Backfill `status = 'published'` for `active = true` rows. Update
   `routes/workshops.ts` and `lib/seoAudit.ts:auditWorkshops` to use
   the same predicate the sitemap uses for the other artifact kinds.

3. **Retire `artifacts/api-server/src/scripts/data/workshops.json`**
   once the production DB is the canonical source — the JSON is a
   one-shot bootstrap fixture today and tends to drift from
   admin-edited rows. Replace with a `pnpm db:dump-seed workshops`
   helper (mirrors what already works for collateral) so fresh dev
   environments hydrate from a live snapshot instead of a manually
   maintained file.

Owner/tracking: file a ticket referencing this section once #95 is
deployed to production and the residual workshop count has been
verified.

---

## SEO & web-platform debt (follow-up to the May 2026 audit)

Context: a May 2026 cross-codebase audit of SEO configuration and
automation confirmed the strong fundamentals already in place
(dynamic sitemap, OG/Twitter tags, JSON-LD, `web-vitals` RUM into
`cwv_samples`, IndexNow + Google + Bing submission, Wix redirect
table, `socialBotRenderer` middleware) but surfaced a tail of
infrastructure-level gaps that don't fit cleanly under any single
product task. The numbered product-backlog items #154–#163 cover the
user-visible work; the items below are the residual platform-debt
follow-ups that pair with them.

Follow-up items, in recommended order:

1. **CSP rollout in report-only mode first.** When #155 (helmet +
   security headers) lands, ship the CSP as `Content-Security-Policy-
   Report-Only` for ≥ 7 days against production traffic, with
   violations posted to a new `/api/csp/report` endpoint that writes
   to a `csp_violations` table. Only flip to enforcing once the report
   stream is empty for two consecutive days. The risk of breaking the
   GA4 / LinkedIn / Meta Pixel / YouTube embed chain on a single
   directive miss is otherwise high.

2. **Move Lighthouse CI from manual to PR-blocking carefully.**
   #156 calls for the swap, but the existing `lighthouserc.json`
   only covers six URLs and the perf assertion is `warn` rather
   than `error`. Before flipping the workflow trigger, audit the
   URL list against the live sitemap top-N and bump perf to
   `error` for the routes that already pass cleanly so the gate
   has teeth. Pair with the publish-blocks warn → block flip in
   "Quality gates" #3 above — they're the same theme.

3. **Pipe `@axe-core/playwright` results into `publish_blocks`.**
   This was already item #5 under "Quality gates" but the SEO
   audit re-confirmed it's still missing. Resolution path: the
   manual `quality.yml` workflow uploads `axe-violations.json`
   as a CI artifact, and a small `pnpm run sync:axe` step calls a
   new authenticated `POST /cms/quality/axe-report` that ingests
   the JSON and writes one row per `serious|critical` violation
   into `publish_blocks` keyed on the artifact's canonical URL.
   Severity stays `warn` until the volume is known.

4. **Generate a `manifest.webmanifest` build artifact, not a
   hand-edited file.** When #154 lands, the manifest should be
   templated from site-settings (theme color, brand name) rather
   than checked in as a static file — otherwise it drifts when
   the brand is themed (#130). Render it from a small Express
   route at `/manifest.webmanifest` that reads the active theme
   and emits the manifest with a `Cache-Control: public,
   max-age=300` header.

5. **Search Console + Bing Webmaster API plumbing.** #160
   describes the user-visible dashboard. The platform-debt
   prerequisite is a service-account-backed credential rotation
   path: the Google API client wants a JSON service account key,
   the Bing Webmaster API wants a per-environment API key, and
   today we have no secret-rotation discipline for either. Add a
   `docs/seo-credentials.md` runbook and a quarterly rotation
   reminder via the existing scheduler before the dashboard goes
   live.

6. **Retire the static `download_url` mirror on `collateral`.**
   Already item #6 under "Quality gates" — re-listing here only
   because the SEO audit confirmed the column is still in the
   schema and still being mirrored on every collateral write.
   Same prerequisite (every consumer reads from
   `collateral_resources`) and the same removal step.

Owner/tracking: file a ticket referencing this section once
#154–#163 are scheduled into a sprint and the audit findings are
acknowledged by marketing leadership.

## A/B experiments — deferred items (follow-up to PR #74)

PR #74 shipped Phase 1 + immediate hardening (Phase 2 items #1–9). The
following are scoped out for a later phase because each one touches
either bucketing semantics, request/response shape, or rendering
architecture in ways that warrant their own PR.

1. **Multi-experiment per page.** The partial unique index
   `experiments_one_running_per_page_uidx` enforces one running
   experiment per `pageKey`. To support overlapping experiments
   (e.g. hero + below-fold), drop the partial unique index, introduce
   an `experiment_groups` table for mutual-exclusion enforcement
   (visitors can only be in one experiment per group), and update
   `useOverride` to merge overrides across multiple active assignments
   with a deterministic precedence rule.

2. **SSR-time bucketing.** Today the experiments runtime is
   client-only, so the SSR'd HTML always renders defaults and swaps
   on hydration. For SEO-sensitive pages (`/services/*`,
   `/case-studies/*`), resolve the assignment server-side from the
   `syn_vid` cookie at first request and inline the chosen variant's
   overrides into the rendered HTML. Requires: making `visitor-id` a
   cookie (not just localStorage), adding a server-side bucketing
   helper that mirrors `cyrb53(visitorId + ":" + key)`, and handing
   the resolved assignments to the SSR layer.

3. **Per-segment targeting.** Limit who enters each experiment by
   device class (mobile/desktop), UTM source, geo, or referrer. Adds
   a `targeting` JSONB column on `experiments`, evaluated client-side
   against the same signals the traffic tracker already captures
   (utmSource on the session, navigator.userAgent for device class,
   Accept-Language as a coarse geo proxy). Out-of-segment visitors
   are treated like out-of-test under #9 — no assignment row, fallback
   rendering.
