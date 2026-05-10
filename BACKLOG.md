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

## Galaxy portal lifecycle redesign follow-ups (follow-up to PR #73)

Context: PR #73 (May 2026) reframed the Galaxy customer portal around the
Synozur transformation lifecycle (Assess → Define → Deliver → Outcomes) and
added five stage pages, a `JourneyStrip` home component, a CEO message card
slot, and a shared `lifecycle.tsx` + `constellation-presentation.ts` module.
The nav restructure collapsed the old flat ten-entry tab bar into six entries
(`Home`, `Assess`, `Define`, `Deliver`, `Outcomes`, `Resources`) with alias
routing so bookmarked deep-links still light up the right tab.

Follow-up items, in recommended order:

1. **Wire the CEO quarterly message card to a real CMS field.** Today it
   renders static placeholder copy. Add a `portal_ceo_message` column (or
   a dedicated settings row) to `site_settings`, expose an admin editor
   at `/admin/settings` → "Portal / CEO message", and make the
   `CeoMessageCard` in `artifacts/galaxy/src/pages/home.tsx` fetch from
   `/api/portal/ceo-message`. The slot already knows its current quarter
   (`currentQuarter()`) so the label is automatic.

2. **Integrate Orbit into the Assess stage.** `stage-assess.tsx` renders
   three `PlaceholderCard` tiles (baseline overview, competitive analysis,
   market intelligence) under an "Integration pending" badge. When the
   Orbit API is available, replace placeholders with live data from that
   API. The Nebula pattern (`nebulaApi`) is the reference implementation.

3. **Integrate Zenith into the Define stage.** `stage-define.tsx` renders
   four `PlaceholderCard` tiles (state of content, AI readiness, policy
   conformance, IA model) under an "Integration pending" badge. Same
   pattern: introduce a `zenithApi` module and wire data.

4. **Integrate Vega into the Outcomes stage.** `stage-outcomes.tsx` is
   entirely placeholder today. Vega API TBD.

5. **Update the old flat portal page links.** Pages like `/documents`,
   `/invoices`, `/apps`, `/reports`, `/workspaces`, `/assessments`,
   `/learning`, `/benchmarks` remain routed and functional but are no
   longer top-level nav entries — they're surfaced via their parent stage
   pages. Ensure internal "All → " links on each stage page point to the
   correct deep pages, and confirm the `aliases` array in `PORTAL_NAV`
   covers every deep route a customer might have bookmarked.

6. **Suppress the "Browse your apps" button removal from existing tests.**
   The PR removed the `/apps` button from the home hero. Any e2e test
   asserting `data-testid="link-apps"` will now fail. Audit the test suite
   and update or retire those assertions.

7. **Add `data-testid` attributes to the stage nav items.** The desktop
   portal nav bar now renders `data-testid="nav-assess"`, `nav-define`,
   etc. (already present via `n.label.toLowerCase()`). Confirm coverage in
   the e2e harness and add stage page smoke tests.

Owner/tracking: file a ticket referencing this section once prioritized.

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

---

## Galaxy portal lifecycle redesign (follow-up to May 2026 portal IA refactor)

Context: the May 2026 redesign on `claude/redesign-portal-homepage-ku1rT`
collapsed the Galaxy portal's flat 10-entry top nav into the customer
lifecycle (`Home, Assess, Define, Deliver, Outcomes, Resources`) and
rebuilt the homepage around that journey. To keep the diff scoped to
the IA shift, six pieces were intentionally deferred — the structural
slots are in place (visible placeholder cards or static content) so
each integration is a fill-in, not a re-design.

Follow-up items, in recommended order:

1. **Back the CEO quarterly message slot with a CMS field.** Today
   `CeoMessageCard` in `artifacts/galaxy/src/pages/home.tsx` renders
   static placeholder copy. Add a small `portal_announcements` row
   (or extend `site_settings`) keyed by quarter (`YYYY-QN`) with
   `markdown_body`, `author_name`, `published_at`, plus an admin
   editor under `/admin/site-config/`. Render the most recent
   `published_at <= now()` entry; fall back to a "no message this
   quarter" empty state instead of the placeholder text. Cache for
   5 minutes — quarterly cadence does not need fresh-on-every-load.

2. **Orbit integration — baseline overview, competitive analysis,
   market intelligence.** `pages/stage-assess.tsx` currently renders
   three `PlaceholderCard`s under "Market context" with the badge
   `Integration pending`. The intended data shape per card:
   - *Baseline company overview* — high-level positioning derived
     from Orbit's dashboard, mapped to either the client's own
     company or the chosen baseline org. One headline metric +
     prose summary per Orbit "company-baseline" record.
   - *Competitive analysis* — latest competitive landscape report
     (peers list, threats list, daylight summary).
   - *Market intelligence reports* — paginated quarterly market
     signal reports curated for the engagement.
   Backend prerequisite: an `orbit` source-app surface in the
   portal API (mirroring the `nebula` / `orion` / `constellation`
   patterns under `lib/api-client-react`). Until Orbit ships a
   client-projection endpoint, leave the placeholders in place.

3. **Zenith integration — readiness and policy reports.**
   `pages/stage-define.tsx` renders four `PlaceholderCard`s under
   "Readiness and policy". The intended top-level reports:
   - *State of content* — content health (coverage, freshness,
     ownership gaps).
   - *AI readiness* — pillar-level AI maturity scoring.
   - *Policy conformance* — adoption / drift signal across
     published policies. (This is why Zenith belongs in **Define**
     and not **Outcomes** — the policy view is a definitional input
     to the strategy, not an outcome trendline.)
   - *Information architecture* — the IA reference model the
     engagement is being measured against.
   Backend prerequisite: a `zenith` source-app projection in the
   portal API exposing top-level summary cards (not full reports).

4. **Vega integration — executive operations overview.**
   `pages/stage-outcomes.tsx` renders four `PlaceholderCard`s.
   Critical scoping constraint: surface **executive-level views
   only** — current state of operations, outcome trendlines,
   adoption signal, strategic-permanence summary. Do **not** expose
   operator drill-downs, individual telemetry, or team-level
   adoption breakdowns through the portal — those stay inside Vega
   itself. Backend prerequisite: a `vega` source-app projection
   that returns only the exec-summary aggregations and refuses to
   leak the operator dataset.

5. **Resources — define the shared-documents area.** The
   "Shared workspace" section in `pages/stage-resources.tsx`
   currently renders a single `PlaceholderCard` flagged `TBD`. The
   open question is editorial, not technical: what cross-engagement
   reference materials live here (templates, frameworks, reusable
   IP)? Once decided, this can ride on the existing
   `useListPortalDocuments` plumbing with a new "shared" engagement
   scope, or a dedicated `portal_shared_documents` projection if
   the access model differs from per-engagement docs.

6. **Map relationship-manager details onto the homepage.** The May
   2026 redesign explicitly punted the relationship-manager mapping
   (`me.accountTeam` already covers account-manager / primary-
   contact roles, but the broader RM-to-engagement-to-client mapping
   was deferred). Once the RM data model is finalized, surface RM
   details inline on the homepage account-team card and on each
   `EngagementCard` (currently shows `accountLead` only). Likely
   needs a new `PortalRelationshipManager` projection on `/api/portal/me`
   plus per-engagement RM context.

Owner/tracking: file a ticket referencing this section once Orbit /
Zenith / Vega land their portal projections and the relationship-
manager data model is signed off.

---

## Wix-platform parity gaps (May 2026 gap analysis)

Context: a May 2026 capability comparison against the Wix platform
surfaced four functional areas where the Wix product has first-class
support and Synozur-WebBase does not. eCommerce, social marketing, and
email marketing were excluded from scope. The four areas below are
ordered by impact on the editorial / marketing experience. Each is its
own initiative; only the page-authoring item has a detailed plan
document attached today (see `docs/no-code-page-authoring-plan.md`).

### 1. No-code page authoring + in-place editing

The most fundamental gap. Today every public page is a hand-written
React component; non-developers can edit hero/intro copy on the parent
list pages (`content_parent_pages`), individual posts (TipTap), and a
narrow set of `site_settings` fields, but cannot create new pages,
reorder sections, or change layout without a deploy. Wix's Editor /
Studio is built around this.

**Status (May 2026): not scheduled.** Two cheaper interventions
(below) close most of the day-to-day editorial pain without taking
on the full block-builder surface area. Revisit only if (a) demand
for actual *new* pages without a deploy materialises, or (b) the
remaining hand-coded pages start churning often enough to justify
a builder.

Detailed staged plan kept on file at
**`docs/no-code-page-authoring-plan.md`** as the "if we need it
later" reference (≈12 engineer-weeks). Headline scope was: new
`pages` + `page_blocks` + `page_revisions` tables, ~10-block typed
registry, admin page builder, live-site edit overlay with
working-copy publish, opt-in migration of static pages.

#### 1a. Lightweight static-page editing (≈2-3 engineer-weeks)

The 80%-value alternative to the full builder. Targets the handful
of hand-coded marketing pages that genuinely don't change often
(`/about`, `/contact`, `/privacy`, `/terms`, `/partners`,
`/clients`) plus any future static page that needs editorial
control over hero/body/CTA without a deploy.

Scope:

1. **Generalise `content_parent_pages` into `static_pages`.** Add
   `body_html` / `body_markdown`, `cta_label`, `cta_href`,
   `secondary_cta_label`, `secondary_cta_href`, optional
   `feature_media_id` alongside the existing hero / intro / SEO
   columns. Keep `slug` as the lookup key.
2. **2–3 reusable typed sections** that hand-coded pages can drop
   in and that read content from small, dedicated tables: a logo
   strip (already half there via the rotator data), a testimonial
   block, a CTA card. Each is a typed table + admin form + a
   single React component — no registry, no builder.
3. **Admin form per static page** under `/admin/site-config/static-pages`
   with the existing `RichTextEditor` for body, `MediaPickerModal`
   for media, and a per-page preview button.
4. **Migrate the listed pages one at a time** to read from the
   table with the existing hardcoded copy as the fallback (same
   pattern `content_parent_pages` already uses).

Sequencing: ship 1+3 first (covers /privacy, /terms, /about),
then 2 if/when a section actually needs to be reused across pages.
Don't pre-build sections nobody is asking for.

Owner/tracking: file as a single ticket; absorbs the editorial
asks that motivated the full builder discussion.

#### 1b. Preview buttons + in-place edit wedge (this PR)

Independent of (and complementary to) item 1a. Delivers the
"see changes without leaving the live site" workflow that the
full builder would have provided, against the existing hand-coded
pages and DB-driven entities. Implemented as part of the May 2026
gap-analysis branch — see commit history. Scope:

- **`<PreviewButton>`** in every admin edit page header, opening
  the matching public URL in a new tab. For unpublished items,
  appends a short-lived signed `?preview=…` token so admins (and
  only admins) can see drafts.
- **`<EditWedge>`** mounted on every public page that's bound to
  an editable entity. Renders only for users with the relevant
  capability. Opens a modal exposing the most-edited fields
  (title, subtitle, hero image, SEO title / description, OG
  image, status). "Open full editor" link inside the modal jumps
  to the admin page when deeper edits are needed.

### 2. Multilingual / i18n

There is no i18n scaffolding today — every string is English, every
content row is single-language, and routing has no locale segment.
Wix Multilingual covers 180+ languages with per-language SEO and
auto-translation. If the brand needs a non-English experience, this is
a substantial build:

1. **Routing model.** Decide between path-prefix (`/es/...`),
   subdomain, or query param. Path-prefix is the SEO-friendliest and
   the easiest to fold into the existing Wouter setup.
2. **Translation surface for static UI strings.** Adopt
   `react-intl` or `i18next` and migrate the SPA's hardcoded strings
   into a message catalog. Coordinate with the `synozur-nav` library
   so navigation labels travel with the locale.
3. **Localized content.** Add a `locale` column (or per-locale
   sibling rows) to the major content tables: `posts`,
   `case_studies`, `services`, `solutions`, `applications`,
   `models`, `faq_items`, `team_members`, `events`, `webinars`,
   `polaris_episodes`, `collateral`, plus `content_parent_pages`
   and the new `pages` model from item 1.
4. **Per-locale SEO.** `hreflang` tags, per-locale sitemaps, OG
   image regeneration with translated copy, canonical handling.
5. **Authoring UX.** Locale switcher in admin editors; inline
   "missing translation" indicators; optional machine-translation
   pre-fill (Anthropic call wrapped behind a feature flag).
6. **Search.** Index per-locale TSV vectors; the existing
   `search_tsv` generated columns currently hard-code
   `'english'` (see `lib/db/src/schema/posts.ts`) and need to fan
   out per locale.

Owner/tracking: scope the languages first (count, write vs. read,
machine vs. human translation budget) before opening engineering
tickets. The smallest viable shape is "English + one secondary
language for marketing surfaces only," which is a meaningful slice and
would surface most of the routing / SEO work without forcing the full
content-table refactor on day one.

### 3. Live chat + community (forum / groups)

Wix ships Wix Chat (visitor-to-operator real-time messaging with
mobile operator app, automated triggers, business hours) and
Wix Forum / Wix Groups (threaded discussions, member-to-member
chat, group rules). The codebase has none of this; comments on
insights posts are the only community surface.

Decisions to make before scoping:

1. **Live chat — buy or build?** A managed third-party (Intercom,
   Crisp, HubSpot Chat — already paired with our HubSpot CRM) is
   substantially less effort than building, and the operator
   mobile experience is non-trivial. Recommend evaluating
   HubSpot Conversations first since it shares the contact graph
   with our existing HubSpot integration; LiveChat / Crisp /
   Intercom are alternates. The build-it-ourselves option only
   makes sense if the chat needs to share auth, permissions, and
   data with the portal (Galaxy / Constellation), which it
   probably doesn't for a marketing-site widget.
2. **Forum / community — is there demand?** Wix Forum sees
   engagement on community-led brands; for an advisory firm,
   a moderated Q&A page (built on the existing comment +
   moderation queue plumbing extended to standalone questions)
   may cover the same need at a fraction of the cost. Evaluate
   audience interest before committing.
3. **If we do build a forum**, the existing `comments`,
   `taxonomy`, `users`, and `audit_log` tables give us most of
   the moderation primitives. New surface area: thread / topic
   model, reactions, follows, notifications (depends on email
   marketing infrastructure being out of scope for this gap
   analysis but in scope for a forum build), and a member
   activity feed.

Owner/tracking: do the buy-vs-build evaluation for live chat as a
discrete spike before any engineering work.

### 4. Bookings depth (calendar sync, classes/groups, analytics)

The codebase has a working bookings flow at `/start` backed by a
`bookings` table and admin management. Wix Bookings adds:

1. **Calendar sync.** Two-way sync with operator Google / Microsoft
   365 calendars so a booking blocks the operator's real calendar
   and a calendar-only event holds the slot. This is the largest
   single piece of work — it requires Graph + Google Calendar
   integrations, conflict detection, and a per-staff availability
   model that supersedes the current single-availability flow.
2. **Class / group / workshop bookings.** Multi-attendee slots,
   capacity, waitlists. Today the slot model assumes 1:1
   consultations.
3. **Bookings analytics dashboard.** Top-performing services,
   peak times, attendance vs. cancellation rate. The existing
   admin analytics dashboard could host this once events are
   modelled with consistent dimensions (service / staff / time
   bucket / outcome).
4. **Reminders + post-booking automations.** Opt-in reminder
   emails, follow-up flows. Email infrastructure (`SendGrid`)
   is already wired; the gap is the rule engine that triggers
   it.
5. **Payment-ready bookings.** Out of scope per gap-analysis
   exclusions.

Owner/tracking: the calendar-sync piece is the gating prerequisite
for any of the others to be useful, and is itself a multi-week
build. Recommend a small spike to validate the Graph +
Google-Calendar token storage model and the conflict-resolution
strategy before sizing the rest.

---

## Short-link root path takeover (follow-up to May 2026 production fix)

**Context:** `aka.synozur.com` is the Replit deployment's primary custom
domain. Replit's reverse proxy routes by path prefix, not by hostname — the
api-server only claims `/api`, `/.well-known`, and `/oauth`, so a request for
`aka.synozur.com/cfmtest` (path `/cfmtest`) falls through to the Synozur SPA
(which claims `/`). The SPA's `/*` → `index.html` static rewrite fires and
React Router renders a 404 instead of the intended redirect.

**Interim fix shipped (May 2026):**
Two-part workaround that keeps the SPA serving at `/` while still redirecting
short-link traffic to the api-server:

1. `artifacts/synozur/index.html` — inline blocking `<script>` that fires
   before React mounts. Detects `window.location.hostname === 'aka.synozur.com'`,
   extracts the first path segment, and calls `window.location.replace('/api/r/<slug>')`.
   Passthrough segments (api, admin, galaxy, images, etc.) are excluded.

2. `artifacts/api-server/src/routes/shortLinks.ts` — new public
   `GET /api/r/:slug` endpoint. Performs the full short-link resolution: DB
   lookup, click recording, query-string merging, bot OG rendering, and HTTP
   redirect. No hostname guard — it's opt-in by explicit URL.

**Limitations of the workaround:**
- Social bots that skip JavaScript (rare; most crawlers do execute JS) receive
  the SPA's blank `index.html` and never reach the bot OG renderer. For links
  with curated OG overrides the unfurl preview would be wrong for those bots.
- The redirect chain is two hops for regular users: `aka.synozur.com/slug` →
  _(JS replace)_ → `aka.synozur.com/api/r/slug` → _(302)_ → `target`. Modern
  browsers handle this in milliseconds with no visible flash, but it's not as
  clean as a direct server-side redirect.

**Proper fix — api-server root path takeover:**
The api-server's `artifact.toml` should claim `/` in addition to `/api`,
`/.well-known`, and `/oauth`. The api-server would then become the sole
production handler for all paths and hostnames, with the existing
`shortLinkRedirectMiddleware` intercepting `aka.synozur.com/*` traffic and a
new static-file fallback serving the SPA's compiled `dist/public/` for all
other hostnames.

Implementation steps:

1. **Update `artifacts/api-server/.replit-artifact/artifact.toml`:**
   Add `"/"` to `[[services]] paths`.
   Use `verifyAndReplaceArtifactToml` per the artifacts skill — do not edit
   `artifact.toml` directly.

2. **Update `artifacts/synozur/.replit-artifact/artifact.toml`:**
   Remove `paths = ["/"]` from the SPA service and drop `serve = "static"` /
   `publicDir` / `[[services.production.rewrites]]` from `[services.production]`.
   Keep the `build` array so Replit still compiles the SPA dist during
   deployment. The api-server then serves those files, not a separate static
   server.

3. **Add static-file fallback to the api-server Express app (`app.ts`):**
   After all `/api` routes, mount `express.static('artifacts/synozur/dist/public', { index: false })`
   followed by a catch-all that sends `artifacts/synozur/dist/public/index.html`
   for unmatched paths. Gate this on `NODE_ENV === 'production'`; in
   development, add an `http-proxy-middleware` target to the SPA's Vite dev
   server on port 20131 for non-short-link-host requests so the dev experience
   is unchanged.

4. **Remove the interim workaround:** delete the blocking script from
   `artifacts/synozur/index.html` and the `GET /api/r/:slug` route from
   `shortLinks.ts` (or keep the route as a permanent redirect alias — it
   causes no harm and could be useful for direct API consumers).

**Risk notes:**
- The SPA's Vite dev server must still run during development; the api-server
  proxy must forward to it for non-`aka.synozur.com` requests.
- If Replit's proxy treats equal-specificity path conflicts
  (both services claiming `/`) as undefined behaviour, the SPA's path claim
  must be removed — not merely coexist. Verify via a staging deploy before
  cutting production.
- The api-server's static fallback must replicate the SPA's `/*` → `index.html`
  client-side routing behaviour for every unknown path so no existing SPA route
  regresses to a 404.

Owner/tracking: open a project task once the Wix-platform parity backlog and
launch-readiness checklist are clear; this is a medium-complexity infra change
with no user-visible feature delta, so it should be batched with the next
artifact-routing or server-consolidation effort.
