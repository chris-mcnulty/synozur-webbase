# Synozur Alliance — Product Backlog

> Last updated: May 4, 2026  
> 11 tracked tasks · 3 strategic roadmap items · 53 merged · 0 cancelled (older merged / cancelled rows rolled over per the convention noted below)

Tasks are grouped by theme. Entries with a `#` ref correspond to project task system records (PROPOSED or active). Entries in the **Strategic Roadmap** section are planned future initiatives that do not yet have a project task record. Items shown with strike-through were verified as already shipped during the May 2026 SEO audit pass and are kept here only until the next merged-tasks rollover.

## 🚦 Launch Readiness — Pre-Production Gate

Locked in May 2026 as the gating checklist for the public launch of `synozur.com`. Items in **Tier 1** must close before public launch; Tier 2 must close before any external announcement / SEM spend; Tier 3 can ship in week 1 post-launch.

Each row links to the canonical backlog entry below where the implementation detail lives. This section is the single source of truth for go/no-go status — update the checkbox as items close.

### Tier 1 — Critical, must ship before public launch

- [ ] **L1. Production auth cutover** → BACKLOG.md "Clerk removal cleanup" #1, #2, #3.
  Run `pnpm --filter @workspace/db run push` in staging then production; provision the Entra app registration per environment (redirect URIs, `User.Read` delegated + `GroupMember.Read.All` application permissions with admin consent, `synozur.com` domain claim hint); set `ENTRA_TENANT_ID`, `ENTRA_APP_CLIENT_ID`, `AUTH_REDIRECT_URI`, `ENTRA_APP_CLIENT_SECRET` in each env's secret store; purge legacy `CLERK_*` env vars. **Blocks every signed-in flow.**
- [ ] **L2. Search Console + Bing Webmaster verification** → #160.
  Add `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` to `index.html` keyed off env vars; confirm DNS TXT record at the registrar; submit the sitemap manually for the first crawl. **Blocks organic discoverability — the site is invisible to Google until verified.**
  **Code shipped:** the SPA server (`artifacts/synozur/server.mjs`) splices both meta tags into the bare HTML response from `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` env vars at boot. The new `/admin/site-config/launch-readiness` page surfaces the live env-var state per channel so an admin can verify configuration without grepping startup logs. **Remaining ops:** set those two env vars in production, confirm DNS TXT, and submit the sitemap from each console.
- [ ] **L3. Live IndexNow / Google Indexing / Bing Webmaster credentials** → #102.
  Set `INDEXNOW_KEY` (and serve `/{key}.txt`), `GOOGLE_INDEXING_SA_JSON` (service account), `BING_API_KEY`, `BING_SITE_URL` in production; verify a test publish triggers a real submission. **Without these, every submit returns `ok: false` and new content waits days for organic discovery.**
  **Code shipped:** all three submission channels are implemented in `artifacts/api-server/src/lib/seoSubmit.ts`; the api-server logs each channel's status at boot under the `launch-readiness: L3 SEO submission` prefix, and the new `/admin/site-config/launch-readiness` admin page exposes the same per-channel status as JSON via `GET /api/cms/launch-readiness`. **Remaining ops:** set the four env vars and verify a test publish.
- [ ] **L4. Security headers via `helmet`** → #155.
  Ship CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Roll out CSP as `Content-Security-Policy-Report-Only` for ≥ 7 days against production traffic before enforcing (per BACKLOG.md "SEO & web-platform debt" #1). **Required by enterprise procurement reviews and pen tests.**
  **Code shipped:** helmet wired in `artifacts/api-server/src/lib/securityHeaders.ts` (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) and the same headers applied to public HTML responses in `artifacts/synozur/server.mjs`; CSP defaults to `Content-Security-Policy-Report-Only` and posts violations to `POST /api/csp/report` (`artifacts/api-server/src/routes/csp.ts`), which dedups them into the new `csp_violations` table; admin dashboard at `/admin/site-config/csp-violations` lets operators filter by directive, see hit counts and last-seen timestamps, and delete resolved rows. The dashboard now also surfaces an enforce-readiness verdict (`ready` / `monitoring` / `blocked` / `no-data`) backed by `GET /api/cms/csp/readiness`, computed from the days-since-last-violation against a 7-day clean window. **Remaining ops:** wait for the readiness banner to flip to `ready`, then set `CSP_ENFORCE=1`.
- [ ] **L5. Production GA4 + pixel IDs + privacy review.**
  Confirm `VITE_GA4_ID` (or DB override `tagGa4Id`) is the production tag, plus the LinkedIn and Meta pixel IDs in site settings. Re-read `/privacy` against the actual tag set so the listing matches reality. Cookie-consent gating is already correct, but a wrong tag ID silently drops every conversion event. **Blocks attribution from day one.**
  **Code verified:** the privacy page at `artifacts/synozur/src/pages/privacy.tsx` already enumerates GA4, LinkedIn Insight Tag, and Meta Pixel — matching the loader in `components/analytics.tsx`. The api-server logs whether each tag ID is configured (DB or env) at boot under the `launch-readiness: L5 marketing tag` prefix; the new `/admin/site-config/launch-readiness` page renders the same per-tag status. **Remaining ops:** populate `tagGa4Id` / `tagLinkedinPartnerId` / `tagMetaPixelId` in the admin SEO page, OR set the `VITE_*` env-var fallbacks.
- [ ] **L6. Wix-redirect production sweep** → #84 residual.
  Pull the top 100 not-found URLs from `not_found_logs` after staging traffic; confirm no high-traffic legacy URL is missing a redirect rule. Better to do this once before launch than to lose two weeks of crawl budget. **Last-mile cleanup on already-shipped infrastructure.**
- [ ] **L7. Backfill per-page OG / SEO data on production artifacts** → #86 residual.
  The OG-serving infrastructure is shipped, but `seoTitle`, `seoDescription`, and `ogImage` are blank on most production artifact rows, so every shared link previews with the same global default. **Code shipped:** `artifacts/api-server/src/scripts/runSeoBackfill.ts` wraps the existing `runAudit()` + `applyAutofill()` helpers and is the operational entry point — dry-run by default, prints per-kind totals + per-(kind, missing-field) counts, and only fills empty columns when `--apply` is passed. Run `pnpm --filter @workspace/api-server exec tsx src/scripts/runSeoBackfill.ts` in production for a dry-run, then `… -- --apply` once editorial signs off on the suggestions; `--kinds=insight,case-study,…` restricts the operation to specific artifact types. For `ogImage`: dynamic OG image generation (#161) shipped in May 2026 so the bot middleware now falls back through the per-kind dynamic renderer before reaching the global `seoDefaultOgImageUrl`; the only remaining gap is editor-authored overrides for hero artifacts where the dynamic render is generic. **Resolver coverage broadened (May 2026):** `ogResolver.ts` now falls back to dynamic OG renders for `services`, `solutions`, `applications`, `models`, and `workshops` (previously each of these resolved to the site-default image when no editor override existed), surfaces `imageUrl` on `/team/:slug` person pages, and fills the missing description on `/library/:slug` and `/webinars/:slug` from `collateral.subtitle` / `collateral.description`. The same patch fixes a silent pre-existing crash where `loadSiteDefaults` selected a non-existent `seoDefaultOgImageUrl` column on `site_settings` and dropped through to the hard-coded `/images/hero-bg.png` fallback on every request — the resolver now joins through `seoDefaultOgImageMediaId → mediaTable` so the admin-configured default actually wins. **OG cache regeneration:** `POST /api/og/regenerate` (admin/editor only, body `{ kind, id, prerender? }`) drops every cached PNG for `(kind, id)` regardless of `lastModifiedMs` and optionally re-renders synchronously — closes the orthogonal gap where the renderer template changes (same row, same `updated_at`) but the cached bytes need to be regenerated. Backed by `clearCachedOgImage(kind, id)` in `artifacts/api-server/src/lib/ogImageCache.ts` which clears both the in-memory LRU and every matching object in `PRIVATE_OBJECT_DIR/og-cache/{kind}/{id}/`. **Remaining ops:** run the backfill in production with editorial sign-off, then hand-author OG copy / images for the top-30-traffic artifacts. **Without this, shared links for those flagship pages still preview with the dynamic-default card rather than a bespoke one.**

### Tier 2 — Strongly recommended, ship before announcing

- [x] **L8. Akismet production key** → #152 residual. **Shipped May 2026.**
  `AKISMET_API_KEY` is provisioned (verified `valid` against `rest.akismet.com/1.1/verify-key`) and the comment-check round-trip was confirmed end-to-end with the documented `viagra-test-123` always-spam pattern (lands as `status=spam` with `spam_signals=["akismet"]`) and a ham control (lands as `status=pending`). Rule-based fallback still kicks in when Akismet is unavailable (timeout / error / `invalid`).
- [ ] **L9. Auth + rate-limit smoke tests in CI** → #119, #144.
  Sign-in Playwright test exercising `/sign-in → Entra → /callback → /api/auth/me`, plus a test that confirms the registration endpoint returns 429 above the rate-limit threshold. Both protect surfaces that will get probed within hours of launch.
  **Code shipped (sign-in tier):** `artifacts/synozur/tests/sign-in.spec.ts` (PR #71) covers (a) always-on render assertions on `/sign-in` plus a verified redirect from the Entra button to `login.microsoftonline.com` with `client_id` and `code_challenge` query params asserted, and (b) a full `/sign-in → Entra → /callback → /api/auth/me` round-trip gated on `E2E_ENTRA_TEST_USER_EMAIL` + `E2E_ENTRA_TEST_USER_PASSWORD` env vars so CI doesn't require an Entra test tenant by default. **Remaining gap:** provision those two secrets for the CI environment to unlock the full round-trip; the rate-limit (429) test is not yet written.
- [x] **L10. PR-blocking Lighthouse CI** → #156. **Shipped May 2026.**
  A dedicated `lighthouse` job in `.github/workflows/quality.yml` now runs on every `pull_request` and on `push: main`, boots the same postgres + api-server + synozur stack as the manual `e2e-and-lighthouse` job, runs `lhci autorun`, uploads `.lighthouseci/*.html` + the manifest as the `lighthouse-report` workflow artifact, and posts a sticky PR comment (`marocchino/sticky-pull-request-comment@v2`, header `lighthouse-ci`) with per-route Perf / A11y / Best-Practices / SEO scores plus the list of any blocking failures. `lighthouserc.json` was rewritten to use `assertMatrix` so the clean-route set (`/`, `/about`, `/services`, `/insights`, `/contact`) gates at `error` for all four categories while the still-noisy routes (`/library`, `/applications`) stay at `warn` until the SEO/perf cleanup tracked in #161 (dynamic OG) and the broader BACKLOG.md "SEO & web-platform debt" cleanup ships. README badge added linking to the latest run.
- [x] ~~**L11.** PWA manifest + `theme-color` → #154.~~ **Shipped May 2026 (implemented in #234).**
  ~~Required for the iOS Safari "Add to Home Screen" experience and for the Lighthouse PWA audit to score above zero. Disproportionate quality signal for the effort (≈1 hour).~~

### Tier 3 — Polish, can ship in week 1 post-launch

- [x] ~~**L12.** `eslint-plugin-jsx-a11y` author-time a11y gate → #158.~~ **Shipped:** flat-config ESLint at the workspace root (`eslint.config.js`) wires `eslint-plugin-jsx-a11y` over `artifacts/synozur/src/**`, must-have rules at `error` (alt-text, anchor-is-valid, aria-props, aria-role, label-has-associated-control, no-static-element-interactions, no-noninteractive-element-interactions) and stylistic ones at `warn`. `pnpm run lint` is green; lint-staged + a Husky pre-commit hook block staged `.tsx` regressions; CI runs lint before typecheck in `quality.yml`.
- [x] ~~**L13.** 410 Gone / 308 Permanent Redirect for unpublished content → #162.~~ **Shipped May 2026.**
  Public artifact loaders now return HTTP 410 with a friendly JSON body when the row is `status='archived'` or `unpublished_at <= now()` — applied to insights, case studies, white papers, services, solutions, applications, models, Polaris episodes, and workshops (workshops have no status enum, so a deactivated `active=false` row is the unpublish signal). Helper lives at `artifacts/api-server/src/lib/goneResponse.ts`. Wix redirect schema (`routes/wixRedirects.ts` zod + admin UI dropdown at `/admin/site-config/redirects`) now accepts 301 / 302 / 307 / 308 — 307 / 308 are the method-preserving variants. Sitemap (`routes/seo.ts`) already filtered on `status='published' AND unpublishedAt > now()`, so unpublished rows drop on the next 5-minute regen — verified, no change needed. E2E coverage in `artifacts/api-server/src/routes/insights.gone.test.ts`.
- [x] ~~**L14.** Dynamic OG image generation for editorial content → #161.~~ **Shipped May 2026.**
  `GET /api/og/image?kind=&id=` (`artifacts/api-server/src/routes/og.ts`) renders a 1200×630 PNG via `lib/ogImageRenderer.ts` (SVG → `sharp`) with the brand gradient, "THE SYNOZUR ALLIANCE" wordmark, kind badge, title, byline (author for insights — with the author's `avatarUrl` re-encoded through `sharp` and inlined as a base64 data URI inside the SVG, falling back to an initials disc if the fetch fails), and a context line (client + industry for case studies, doc type for white papers, episode number + guest for polaris). Renders are cached in `PRIVATE_OBJECT_DIR/og-cache/{kind}/{id}/{updatedAtMs}.png` by `lib/ogImageCache.ts` with an in-memory LRU fallback for dev environments without object storage configured. The frontend wires the fallback through every editorial detail page (`insight-detail.tsx`, `case-study-detail.tsx`, `white-paper-detail.tsx`, `polaris-episode-detail.tsx`) via `lib/og-image-url.ts`, and the server-side `lib/ogResolver.ts` (used by `socialBotRenderer.ts` for crawler unfurls and by the `/api/og` SPA endpoint) does the same fallback chain so editor-set overrides still win. Polaris was missing from the resolver entirely and is now wired up alongside the dynamic fallback.
- [x] ~~**L15.** Honor `prefers-color-scheme` for first-time visitors → #165.~~ **Shipped May 2026 (implemented in #238).**
- [x] ~~**L16.** Share rail on insight / case-study / white-paper detail pages → #164.~~ **Shipped May 2026.**
- [ ] **L17.** Quality-gates warn → block flip → BACKLOG.md "Quality gates" #3, #4 (once warn-mode metrics are clean).
- [x] ~~**L18.** Robots meta + discovery-friendly 404 page → #163.~~ **Shipped May 2026.**
- [x] ~~**L19.** Expanded JSON-LD coverage (LocalBusiness, Person, Review, VideoObject) → #159.~~ **Shipped May 2026** (code). **Verification gate still open**: automated payload extraction against the dev preview returns 5 PASS / 1 WARN (Polaris, no `embedUrl` — expected) / 0 FAIL / 1 SKIP (no `news`-tagged insight) — see `artifacts/synozur/scripts/extract-prod-jsonld.mjs` and `artifacts/synozur/docs/jsonld-payload-validation.md`. The manual Google Rich Results Test / Schema Markup Validator runs against `https://www.synozur.com` are still pending the apex cutover from Wix and are tracked in `artifacts/synozur/docs/jsonld-rich-results-verification.md`. **Bugs caught and fixed during this pass:** `absolutize` in `person-jsonld.tsx`, `video-jsonld.tsx`, and `local-business-jsonld.tsx` malformed `image` URLs whose source started with `/` (produced `synozur.comimages/...`).
- [x] ~~**L20.** CI broken-link checker → #157.~~ **Shipped May 2026.**
  A new `Broken-link check` workflow (`.github/workflows/link-check.yml`) boots postgres + api-server + the synozur **production server** (`artifacts/synozur/server.mjs` with `API_PORT` pointed at the api-server, not `vite preview`, so route-status 404/410 gating and the `wix_redirects` middleware are exercised the same way they ship), then runs `pnpm --filter @workspace/scripts run link-check` (`scripts/src/link-check.ts`). The script first fetches `${baseUrl}/sitemap.xml` (recursing one level into nested sitemap-index entries, filtered to same-origin URLs) and merges those URLs with a hand-curated set of well-known surfaces (`/`, `/about`, `/services`, `/solutions`, `/applications`, `/case-studies`, `/insights`, `/library`, `/contact`, `/privacy`, `/terms`). It then crawls everything with `linkinator` (`recurse: true`), follows redirects (so the `wix_redirects` middleware doesn't false-positive), and stops at first hop for external links. Per-page totals are bucketed as 200 / 30x / 4xx / 5xx / skipped / allowlisted (plus a per-page table for any page with non-200 results) and land in `.link-check/results.json` + `.link-check/summary.md`. PRs gate on **new** broken links vs. the most recent successful main-branch baseline (downloaded as the `link-check-baseline` artifact via `dawidd6/action-download-artifact`); pre-existing breakage is rendered in a collapsed `<details>` block but does not fail the PR. Push:main re-uploads the baseline (90-day retention). Schedule + workflow_dispatch failures open or refresh a tracking GitHub issue (label `link-rot`) via `actions/github-script`. Allowlist lives at `.github/link-check-allowlist.yml` — each entry has `pattern` (JS regex, `RegExp.test()` substring match) + `reason` + `expires` (YYYY-MM-DD); entries past their expiry date always fail the build. **Remaining ops:** run the workflow once against staging, fold the first batch of legitimate broken targets into PRs, and confirm the gate stays green before relying on it as a hard merge block.

### Owner / cadence

- **Owner:** to be assigned at the launch-readiness kickoff. Editorial owns L7 (OG/SEO copy backfill); the marketing-engineering pair owns L2 / L3 / L5 / L8; platform owns L1 / L4 / L10; QA owns L6 / L9.
- **Cadence:** review this section in the weekly launch standup; flip checkboxes as items close. **Tier 1 must be 7/7 green before the marketing site DNS cut-over.**
- **Definition of done:** an item closes only when the code is in `main`, the configuration is applied to production, and a manual smoke test against the production URL confirms behavior. Code-only or staging-only completion does not count for launch-gate purposes.

---

### Already shipped (recorded so they aren't re-proposed)

The May 2026 audit cross-checked five frequently-suggested editorial enhancements against the codebase. Three are fully shipped — record them here so future intake passes don't re-file them as new work:

- **Estimated reading time on Insights posts** — `posts.readingTimeMin` column populated on seed via `Math.round(words / 200)` in `artifacts/api-server/src/scripts/seedPosts.ts`; surfaced on the article page at `artifacts/synozur/src/pages/insight-detail.tsx:226` ("X min read"); editable per post via `routes/cms/posts.ts`.
- **Related content recommendations on article and case-study pages** — `RelatedRail` component in `artifacts/synozur/src/pages/insight-detail.tsx` (3-up grid, filters out the current post), `relatedQ` in `artifacts/synozur/src/pages/case-study-detail.tsx` (2-up rail), and a generic `components/related-content.tsx` for service- and solution-scoped library views.
- **RSS / Atom feed for Insights** — `GET /api/insights/rss.xml` at `artifacts/api-server/src/routes/insights.ts:93` (RSS 2.0 with `atom:link rel="self"`, `content:encoded`, `dc:creator`, `pubDate`). Polaris also has its own iTunes-namespaced podcast feed at `/api/polaris/rss.xml` aliased to `/polaris/rss.xml`.

The remaining two ("social sharing buttons" and "dark mode") are partially shipped — see #164 (extend the event-detail share rail to editorial pages) and #165 (honor `prefers-color-scheme`) below.

---

## Content Library

### ~~#56 · Let editors manage services and solutions in the admin~~ **— Shipped**
**Depends on:** #40 (services hierarchy backend)

~~The services hierarchy lives in the database but can only be updated by re-running an ingest script — editors have no admin UI to manage it.~~ **Shipped:** the admin shell now ships full CRUD under `/admin/products/` — `services-list.tsx`, `service-edit.tsx`, `service-methodologies.tsx`, `solutions-list.tsx`, `solution-edit.tsx`, and `solution-capabilities.tsx`. (Note: the route prefix landed as `/admin/products/` rather than `/admin/services/` to match the broader `applications` / `case-studies` / `models` admin grouping.) Drag-to-reorder for methodology and capability blocks, TipTap rich text, and role-gated writes are all in place. Verified May 2026.

### ~~#60 · Preview services and solutions before publishing~~ **— Shipped May 2026**
**Depends on:** #39 (services public pages), #56 (services admin UI)

Editors can update service pillars, solutions, and methodology or capability blocks in the admin, but there is no way to see how those changes will render on the public site before saving. This task adds a preview mode: a button in the admin editor opens the corresponding public page in a sandboxed state that renders the current unsaved form values without affecting what live visitors see.

Shipped: preview button wired into `artifacts/synozur/src/pages/admin/products/service-edit.tsx` and `solution-edit.tsx`, opening a sandboxed render of the current form state without touching live content.

### ~~#61 · Track edit history for services and solutions~~ **— Shipped May 2026**
**Depends on:** #39 (services public pages), #56 (services admin UI)

The Insights CMS stores a revision snapshot on every save so content can be restored. Services, solutions, methodology blocks, and capability blocks have no equivalent — once an edit is saved the previous version is gone. This task extends the revisions system to cover the entire services hierarchy and adds a revision history panel with restore support to the admin editor.

Shipped: revisions snapshot + restore now run for services, solutions, methodologies, and capabilities via the shared `RevisionsPanel` (`artifacts/synozur/src/components/admin/RevisionsPanel.tsx`) wired into `service-edit.tsx`, `solution-edit.tsx`, `service-methodologies.tsx`, and `solution-capabilities.tsx`.

### ~~#66 · Preview a revision's content before restoring it~~ **— Shipped May 2026**
**Depends on:** #48 (post revisions)

The revision history panel lists past versions and lets authors restore them, but authors cannot see what a revision actually contains before committing to the restore. This task adds an inline preview: a modal or side panel that renders the snapshot's title, excerpt, and body alongside the live version so authors can read the content before deciding whether to restore.

Shipped: inline revision preview drawer in `artifacts/synozur/src/components/admin/RevisionsPanel.tsx` renders the snapshot's title, excerpt, and body next to the live version before the author confirms a restore.

### ~~#67 · Show a diff between the current version and a past revision~~ **— Shipped May 2026**
**Depends on:** #48 (post revisions)

When authors are considering restoring a revision they often want to know exactly what changed, not just see the full snapshot. This task adds a side-by-side or inline diff view in the revision history panel that highlights added and removed text in each field between the selected revision and the current live version.

Shipped: side-by-side diff view in `artifacts/synozur/src/components/admin/RevisionsPanel.tsx` highlights per-field additions and deletions between the selected revision and the live version.

### ~~#68 · Automatically trim old revisions to keep storage lean~~ **— Shipped May 2026**
**Depends on:** #48 (post revisions)

Every save creates a new revision. Without a retention policy, the `post_revisions` table grows indefinitely. This task adds a scheduled job (daily cron) that deletes revisions older than 90 days, keeping the 10 most recent regardless of age. The retention window and keep-count should be configurable via admin site settings.

Shipped: daily revision-pruning job runs out of `artifacts/api-server/src/index.ts` against `routes/cms/posts.ts`, honoring the admin-configured retention window + keep-count from site settings.

### ~~#75 · Bulk reorder featured library items via drag-and-drop~~ **— Shipped May 2026**
**Depends on:** #69 (collateral library admin)

Editors can mark collateral items as featured and set a numeric rank to control the order in the home carousel, but adjusting many items requires editing each rank by hand one at a time. This task adds a drag-and-drop reorder screen that lets editors grab and rearrange featured items visually, saving the new order in a single bulk operation.

Shipped: drag-handle reorder mode in `artifacts/synozur/src/pages/admin/library/collateral-list.tsx` persists the new featured-rank order in a single bulk request via `useCmsReorderCollateral`.

### ~~#76 · Show a live preview of how a library item will appear on the public site~~ **— Shipped May 2026**
**Depends on:** #69 (collateral library admin)

Editors filling out collateral fields have to navigate away to the public Library page or home carousel to see how the item renders. This task adds an inline preview panel to the collateral editor that shows a faithful replica of the public card and carousel tile as the editor updates fields, without requiring a page navigation.

Shipped: live grid + carousel previews in `artifacts/synozur/src/pages/admin/library/collateral-edit.tsx` render `CollateralCard` against the in-flight form state via `toPreviewItem(form)` so editors see card and carousel tiles update as they type.

### ~~#185 · Add Playwright coverage for the Polaris collateral sync flow~~ **— Shipped May 2026**
**Depends on:** #69 (collateral library admin), Polaris episode admin

The "Add to library" / "Sync to library" buttons on the Polaris episode editor's Collateral Library sidebar card were previously only covered by manual e2e testing. Shipped: serial Playwright suite at `artifacts/synozur/tests/polaris-collateral-sync.spec.ts` signs in via `POST /api/auth/login`, creates a unique draft episode through the CMS API, persists the storage state, and exercises both `btn-collateral-add` (asserts the "Added to library" toast plus the "In library" copy and the sync/remove buttons) and `btn-collateral-sync` (asserts the "Library entry synced" toast). `afterAll` cleans up the collateral link and the test episode.

### ~~#190 · Extend Zenith solution-enrichment seed to Company OS and Employee Strategies~~ **— Shipped May 2026**
**Depends on:** #56 (services/solutions admin)

The `seedSolutionEnrichments.ts` script only covered three solutions and several other Zenith-relevant solutions had no `acceleratorsHtml` / `faqHtml` content. Shipped: `artifacts/api-server/src/scripts/seedSolutionEnrichments.ts` extended to seed Company OS (slug `company-os`, with Vega framing) and Employee Strategies (slug `employee-strategies`, with Zenith as a digital-workplace signal) using the established 2–3 paragraph callout + 3-Q&A FAQ pattern. Communication Strategies and Delivery Management are intentionally left unenriched — the script header documents the rationale.

### ~~#207 · Show per-episode library sync status in the Polaris episode list~~ **— Shipped May 2026**
**Depends on:** #69 (collateral library admin), Polaris episode admin

Editors had no per-row signal in the admin Polaris list to spot collateral that drifted out of sync after an episode was edited. Shipped: a new "Library" column on the admin Polaris episodes list with a clickable badge per row — `Synced` (collateral exists and `serviceId`/`solutionId` match), `Stale tags` (collateral exists but tags drifted, with tooltip explaining the mismatch), or `Missing` (no collateral row yet). Clicking the badge runs a single-episode sync against the existing `POST /cms/polaris/episodes/:id/sync-collateral` endpoint with spinner + toast UX; `serializeCollateralLink` in `artifacts/api-server/src/routes/polaris.ts` now returns `serviceId`/`solutionId` so the comparison runs client-side, and `PolarisCollateralLinkDto` in `artifacts/synozur/src/lib/api.ts` was extended to match.

### ~~#209 · Apply the confirmation step to other destructive admin actions~~ **— Shipped May 2026**
**Depends on:** —

Most destructive admin actions either had no confirmation or only an unhelpful "Are you sure?" prompt. Shipped: the Polaris-style `confirm()` pattern (with consequence text) is now applied across every destructive admin list/edit page — `library/{workshops,white-papers,videos,collateral}-list`, `products/{solutions,services,applications,models,case-studies}-list`, `products/faq.tsx`, `people/{bookings,team,events}-list`, `insights/{posts-list,post-editor archive,taxonomy,media,comments}`, `library/assets`, and `site-config/{redirects,not-found-logs}`. Missing confirms were also added in `products/service-methodologies` + `solution-capabilities`, `access/entra` (group-mapping removal), and `access/organizations` (user-removal). Message conventions distinguish soft-archive ("…this will remove it from the public site…") from hard-delete copy.

### ~~#151 · Show spam comment count badge on the moderation navigation item~~ **— Shipped May 2026**
**Depends on:** #54 (Insights comments)

The spam moderation tab is functional but there is no visual indicator in the admin sidebar that spam comments are waiting for review. Moderators have to navigate to the tab to discover whether there is pending work. This task adds a count badge to the moderation nav item that shows the number of unreviewed spam-flagged comments so the backlog is visible at a glance.

Shipped: pending-spam badge rendered on the moderation nav item in `artifacts/synozur/src/components/admin/AdminLayout.tsx` via a `useListCmsComments({ status: "spam" })` count + `aria-label` for screen readers.

### ~~#152 · Add Akismet integration to catch more spam automatically~~ **— Shipped May 2026**
**Depends on:** #54 (Insights comments)

~~The current spam scorer uses rule-based heuristics — link count, keyword list, domain blocklist.~~ **Shipped:** `checkAkismet` in `artifacts/api-server/src/lib/spamScorer.ts` is fully wired (HTTP POST, 5 s timeout, graceful fallback) and now also captures Akismet's `X-akismet-pro-tip: discard` header (surfaced as the `akismet-discard` signal in the moderation UI), handles the `invalid` response by logging the `X-akismet-debug-help` reason, and exposes a `verifyAkismetKey()` helper that calls `rest.akismet.com/1.1/verify-key`. `AKISMET_API_KEY` is provisioned and was verified `valid`. End-to-end check on a real published post confirmed the documented `viagra-test-123` always-spam payload lands as `status=spam` with `spam_signals=["akismet"]`, while a control ham comment lands as `status=pending`. Rule-based scoring still runs in parallel and remains the sole signal source when the Akismet call returns `null` (timeout / network error / `invalid`).

### ~~#153 · Make the spam rules settings page accessible to end-to-end automated testing~~ **— Shipped May 2026**
**Depends on:** #54 (Insights comments)

The admin area uses Entra SSO exclusively so the Playwright test runner cannot sign in programmatically to reach the spam rules settings page. The link threshold, keyword list, and domain blocklist UI in site-settings.tsx was manually verified to compile but has no automated test coverage. This task adds a test-environment auth bypass (strictly gated on `NODE_ENV=test`) and adds the missing Playwright tests for the save and remove interactions.

Shipped: `NODE_ENV=test`-gated auth bypass plus Playwright coverage of the link-threshold, keyword-list, and domain-blocklist save/remove interactions in `artifacts/synozur/tests/admin-spam-rules.spec.ts`.

---

## Admin Access & People

### ~~#57 · Verify the new services pages with automated browser tests~~ **— Shipped**
**Depends on:** #40 (services hierarchy backend + public pages)

~~The pillar overview, per-pillar overview, service-detail, and solution-detail pages were built and manually verified but have no automated test coverage.~~ **Shipped:** Playwright suite at `artifacts/synozur/tests/services.spec.ts` covers the full flow — overview → pillar → solution detail with API assertions. Runs in the manual-trigger `quality.yml` workflow alongside the axe a11y suite (`a11y.spec.ts`). Verified May 2026.

### ~~#109 · Careers / HR module under `/admin/people/careers`~~ **— Shipped May 2026**
**Depends on:** admin section reorganization (capability layer + section folders)

~~Today the admin has a `people` section that manages the team grid and events, but nothing for recruiting. This task adds a Careers module.~~ **Shipped:** `lib/db/src/schema/careers.ts` backs the module; api-server routes live under `artifacts/api-server/src/routes/careers/` (`jobs.ts`, `applications.ts`, `settings.ts`) gated on `careers.applications.read` / `careers.applications.write` capabilities, with `careersAi.ts` (AI resume scoring), `careersResumeParser.ts`, and `careersEmail.ts` helpers. Public surface: `pages/careers.tsx`, `careers-detail.tsx`, `careers-apply.tsx`, `careers-applied.tsx`, plus `careers-embed-jobs.tsx` / `careers-embed-job.tsx` embeddable variants and a `careersRedirect.ts` legacy-URL map. Admin module landed under `pages/admin/careers/` (`jobs-list.tsx`, `job-edit.tsx`, `applications-list.tsx`, `application-detail.tsx`, `settings.tsx`) rather than under `pages/admin/people/` to match the broader admin section grouping. Playwright coverage in `artifacts/synozur/tests/careers.spec.ts`. Transactional confirmations run through the current SendGrid path (#220), not the original Resend integration.

### ~~#110 · Show a video thumbnail preview when a custom hero video is active~~ **— Shipped May 2026**
**Depends on:** #106 (hero video background)

When an admin sets a custom hero background video via site settings the page shows only a generic video icon with "Custom video" text — there is no visual confirmation of which video is loaded. This task adds a thumbnail preview in the site settings form that shows either a poster frame extracted on upload or a short muted clip of the active hero video, so admins can confirm the right file is in use without leaving the page.

Shipped: hero-video editor in `artifacts/synozur/src/pages/admin/site-config/site-settings.tsx` now renders a poster-frame thumbnail of the active hero video in-form so admins can confirm the loaded file without navigating away.

### ~~#111 · Validate video uploads before they reach object storage~~ **— Shipped May 2026**
**Depends on:** #106 (hero video background)

The current video upload path accepts any `video/*` MIME type up to 500 MB with no server-side validation of actual file contents. A caller could bypass the MIME check or upload a corrupt or unsupported file (for example, AV1 in MKV) that browsers will not autoplay. This task adds lightweight server-side validation of the real codec, container format, and duration before the file is persisted, and returns a clear error message if the upload fails validation.

Shipped: `artifacts/api-server/src/routes/storage.ts` now enforces an `ALLOWED_VIDEO_MIME_TYPES` allowlist + a `videoBytesMatchContentType` magic-byte sniff for `video/mp4`, `video/quicktime`, and `video/webm`, rejecting mismatched or unsupported uploads with a clear error before they reach SharePoint.

### ~~#119 · Add automated browser tests for the full sign-in and sign-out flow~~ **— Shipped May 2026**
**Depends on:** #115 (sign-in / session management)

The sign-in page works correctly today, but there are no automated tests covering the complete happy path from the public site through authentication and back. This task adds Playwright end-to-end tests for sign-in, the authenticated admin shell, and sign-out, using a test-environment auth bypass so the test runner can reach the admin without real Entra credentials.

Shipped: Playwright coverage for the full sign-in / admin / sign-out happy path in `artifacts/synozur/tests/sign-in.spec.ts` and `sign-in-flow.spec.ts`, with a `NODE_ENV=test`-gated bypass so CI runs without a live Entra tenant.

### ~~#128 · Act as an OAuth 2.0 / OIDC provider for other Synozur web apps~~ **— Shipped May 2026**
**Depends on:** #110 (audience-class model) or can ship in parallel

Shipped: api-server is now a full OAuth 2.0 / OIDC authorization server. `oauth_clients`, `oauth_authorization_codes`, `oauth_refresh_tokens`, and `oauth_signing_keys` tables back `GET /oauth/authorize`, `POST /oauth/token` (authorization_code + refresh_token grants, public PKCE clients supported), `GET /oauth/userinfo`, `GET /.well-known/openid-configuration`, and `GET /.well-known/jwks.json`. RS256 keys rotate via `oauthKeys.ts`. Consent screen, admin UI under `/admin/access/oauth-clients`, and capability-scoped tokens are live. The `@workspace/auth-sdk` helper package (browser PKCE client + Express `requireOidcUser` middleware) is published in-monorepo, and Galaxy is the first downstream consumer — its session-cookie bridge has been replaced with the OAuth flow. The api-server's `attachUserIfPresent` middleware now also accepts `Authorization: Bearer <jwt>` access tokens so any downstream app can call `/api/*` without sharing the `sid` cookie.

### #129 · Cross-app switcher (Constellation, Vega, …) for signed-in users
**Depends on:** #128 (OAuth provider)

Signed-in users who work across multiple Synozur applications (this site, Constellation, Galaxy, and future apps) currently navigate between them by manually typing URLs. This task adds a persistent app-switcher UI element for authenticated users that lists every registered OAuth client the current user has access to, with one-click navigation and instant single-sign-on via the OAuth provider.

### #130 · Admin-controlled UX theme switcher (Baseline / Aurora / …)
**Depends on:** #128 (OAuth provider), #110 (audience-class model)

The site has a single fixed visual theme today. This task adds an admin-controlled mechanism to switch between defined theme presets (for example, Baseline and Aurora) without a code deploy. The active theme is stored in site settings, applied globally via CSS custom properties, and propagated to all registered OAuth client apps through the cross-app theme token so every Synozur surface stays visually consistent.

### ~~#135 · Galaxy client portal — v0~~ **— Shipped May 2026**
**Depends on:** #110 (audience classes — specifically `customer`), #111 (DB-backed capability map), #128 (OAuth provider). SPE storage backend (#127) already shipped — the client-deliverables document browser plugs straight into the existing SPE container layer.

~~The long-planned Galaxy client portal has been a roadmap concept for some time but has no shipped surface. This task lands a **thin v0** that gives existing clients a single authenticated home for their engagement with Synozur.~~ **Shipped:** delivered as a four-task v0 — `#224` (foundation: `artifacts/galaxy` workspace, `client_organizations` + `client_organization_users` + `engagements` schema, `requireCustomerAudience` shim, portal home with `GET /api/portal/me` + `/api/portal/engagements`, "not a customer" redirect), `#225` (client-org admin under `/admin/access/clients` with invite-by-email and audit hooks — see entry below), `#226` (six-app cockpit at `/apps` backed by `portal_artifacts` — see entry below), and `#227` (deliverables document browser at `/documents` backed by `portal_documents` over the existing SPE layer — see entry below). The same-host session-cookie bridge stands in for cross-domain OIDC SSO until #128 lands; swap-out point documented in `requireCustomerAudience`.

### ~~#224 · Galaxy client portal — v0 foundation~~ **— Shipped May 2026**
**Depends on:** #135 (Galaxy v0 umbrella) — same-host session-cookie bridge stands in for #128 OIDC SSO until that lands.

Foundation for the Galaxy client portal. Shipped: new `artifacts/galaxy` Vite + React 19 workspace registered as a web artifact (preview path `/galaxy/`) reusing `lib/api-client-react` and the Aurora theme tokens; new schemas in `lib/db/src/schema/` for `client_organizations`, `client_organization_users`, and `engagements` with idempotent startup migrations in `artifacts/api-server/src/lib/migrations.ts`; `routes/portal/me.ts` (`GET /api/portal/me`) and `routes/portal/engagements.ts` (`GET /api/portal/engagements`, `GET /api/portal/engagements/:id`) gated by the new `requireCustomerAudience(req)` shim that resolves the active `clientOrgId` from `client_organization_users` and is documented as the swap-out point for the eventual #110 audience-class system; portal home page rendering greeting + account-team contact card + active engagements list; "not a customer" dead-end page for users outside any client org so they don't bounce to the admin sign-in flow. OpenAPI spec + codegen updated so the portal consumes typed React Query hooks.

### ~~#225 · Galaxy — client-organization admin in the main site~~ **— Shipped May 2026**
**Depends on:** #135 (Galaxy v0 foundation, #224)

Account managers can now register client organizations, attach existing users, and invite new ones by email without a SQL session. Shipped: `/admin/access/clients` list + edit pages in `artifacts/synozur/src/pages/admin/access/` (`clients-list.tsx`, `client-edit.tsx`) backed by `artifacts/api-server/src/routes/clientOrgs.ts` (CRUD plus `POST /:id/users`, `DELETE /:id/users/:userId`, `POST /:id/invite`). Gated on the new `MANAGE_CLIENT_ORGS` capability granted to `admin` and the new `account_manager` role. Invite emails reuse the existing transactional path with a `client-org-invite` template variant. Every mutation writes through `audit({ action: client_org.* })`.

### ~~#226 · Galaxy — per-application cockpit surfaces (Vega, Nebula, Constellation, Orion, Orbit, Zenith)~~ **— Shipped May 2026**
**Depends on:** #135 (Galaxy v0 foundation, #224), #225 (client-org admin)

The portal "Apps" surface ships as curated portal artifacts (live-API integration is a follow-up gated on #128). Shipped: `portal_artifacts` table (clientOrgId, sourceApp enum vega|nebula|constellation|orion|orbit|zenith, artifactKind, title, summary, payload jsonb, externalUrl, thumbnail, publishedAt, archivedAt) with `(clientOrgId, sourceApp, publishedAt desc)` index; `GET /api/portal/apps`, `GET /api/portal/apps/:sourceApp`, `GET /api/portal/artifacts/:id` reusing `requireCustomerAudience`; admin write surface as the "Artifacts" tab on `/admin/access/clients/:id/edit`; six-card cockpit landing at `/apps` in `artifacts/galaxy` with per-app surfaces (Constellation status board, Vega OKR snapshot, Nebula session list, Orion roadmap, Orbit asset gallery, Zenith governance scorecard) plus hard-coded friendly empty states; per-view `portal.artifact_view` telemetry through the existing traffic hooks.

### ~~#227 · Galaxy — deliverables document browser over SPE~~ **— Shipped May 2026**
**Depends on:** #135 (Galaxy v0 foundation, #224), #127 (SPE container layer)

Clients can now retrieve published deliverables from a single read-only browser scoped to their org. Shipped: `portal_documents` table (engagementId, spePath, spaceItemId, filename, contentType, sizeBytes, lastModifiedAt, publishedAt, publishedBy, indexedAt) with `(engagementId, publishedAt desc)` index; on-demand + daily reconcile indexer that upserts rows from the existing SPE container layer; per-document publish toggle on the engagement admin with `portal_document.publish` / `unpublish` audit events; `GET /api/portal/documents`, `/:id`, and `/:id/content` (streamed through the api-server with `Content-Disposition: attachment` and a `portal_document.download` audit event) all gated by `requireCustomerAudience` plus an explicit org-ownership check; `/documents` route in `artifacts/galaxy` with engagement grouping, sortable columns, and a preview drawer (PDF inline, Office files via the M365 web viewer, images inline, fallback to download CTA).

### ~~#136 · Verify remember-me sessions get the longer 30-day window when renewed~~ **— Shipped May 2026**
**Depends on:** #133 (session management)

`resolveSession()` branches on `rememberMe` to choose between an 8-hour and a 30-day renewal TTL. A regression here would silently downgrade "stay signed in" sessions, signing users out far sooner than expected, but no test currently exercises the `rememberMe` branch. This task adds targeted tests that exercise the renewal code path for both session types and assert that the correct TTL is applied.

Shipped: paired renewal-TTL tests in `artifacts/api-server/src/lib/sessions.test.ts` (`rememberMe:true` → ~30-day window, `rememberMe:false` → ~8-hour window) covering both branches of `resolveSession()`.

### ~~#137 · Cover the session garbage-collector and revocation helpers with tests~~ **— Shipped May 2026**
**Depends on:** #133 (session management)

`sessions.test.ts` only exercises `resolveSession()`. Several other security-relevant helpers — `pruneExpiredSessions()`, `destroyAllSessionsForUser()`, `destroySessionById()`, and the token-revocation path — have no direct tests, so regressions could go unnoticed. This task adds unit and integration tests for each helper, verifying that expired sessions are deleted, active sessions are preserved, and revocation correctly invalidates the targeted tokens.

Shipped: dedicated tests for `pruneExpiredSessions()`, `destroyAllSessionsForUser()`, and `destroySessionById()` in `artifacts/api-server/src/lib/sessions.test.ts` confirm expired-only pruning, per-user revocation isolation, and single-row revocation behavior.

### #141 · Partner & co-marketing portal
**Depends on:** #110 (audience class `partner`), #111 (DB capability map), #128 (OAuth) — and reuses the workspace pattern from #135 (Galaxy)

`/partners` today is a logo wall plus contact CTA. This task promotes it to a logged-in **partner portal** for channel and alliance partners (Microsoft, technology ISVs, regional SIs), so the relationship has a working surface beyond email threads. Scope:
- New audience class `partner` (per #110) with capabilities `partner.dashboard`, `partner.collateral.read`, `partner.deal.register`, `partner.lead.submit`, `partner.mdf.request`.
- Either an `artifacts/partner-portal` workspace or a new authenticated section inside `artifacts/synozur` under `/partners/portal/*` (decision during implementation; the latter is faster to ship, the former scales better — pick after sizing real partner volume).
- **Co-branded landing-page generator**: pick a Synozur service or solution + add partner logo and partner-supplied copy → publish to a unique short URL that renders inside the existing site shell with the chosen theme (#130) and partner branding. Backed by a `partner_landing_pages` table.
- **Deal registration**: form captures opportunity (account name, est. value, close date, products of interest) and writes both a local `partner_deals` row and a HubSpot Deal (#131) attributed to the partner. Conflict check warns if Synozur already has an open opportunity in that account in the last N days (configurable).
- **Shared collateral library**: scoped view of `collateral` rows tagged `partner_visible`; no admin UI rebuild — just an additive `partnerVisible` column and a filter on `/api/partner/collateral`.
- **MDF (market development funds) requests**: form + admin triage queue under `/admin/partners/mdf` with status states `submitted | approved | rejected | paid`.
- **Lead handoff**: partners submit qualified leads into the same HubSpot pipeline as inbound forms, tagged with their partner id for attribution and any subsequent commission accounting.
- Onboarding: partner managers invite primary partner contacts from `/admin/partners/:id/users`; each invite seeds a `partner` audience-class user.

Out of scope: a full PRM (partner-relationship management) replacement, commission calculation, training/certification tracking. Follow-up: pipe partner-attributed deal stage transitions back into HubSpot timeline events for unified reporting.

### ~~#144 · Add automated tests to confirm sign-up rate limiting works~~ **— Shipped May 2026**
**Depends on:** #141 (sign-up rate limiting)

The registration endpoint now enforces rate limiting, but no automated tests verify that a 429 response is returned after the threshold is exceeded or that requests below the limit continue to return 201. This task adds those tests so any future change to the rate-limiting middleware is immediately caught.

Shipped: integration suite at `artifacts/api-server/src/routes/auth.rateLimit.test.ts` asserts that the 6th register request from an IP returns 429 (with the registration-specific message), that the register / login / forgot-password buckets are isolated, and that valid registrations below the limit still return 201.

### ~~#169 · Admin audit-log viewer with entity-scoped activity tab and 365-day retention~~
**Depends on:** —

~~Shipped via #258:~~
- ~~`GET /cms/audit-log` (cursor-paginated, filtered by actor, entity, action prefix, date range) and `GET /cms/audit-log.csv` (10k-row cap) live in `artifacts/api-server/src/routes/cms/auditLog.ts`. Indexes `audit_log_actor_at_idx`, `audit_log_at_idx`, and `audit_log_action_idx` were added to `audit_log` in `lib/migrations.ts`.~~
- ~~Global viewer at `/admin/access/audit-log` with filter bar, infinite scroll, CSV export, and a row drawer showing field-level before/after diffs.~~
- ~~Reusable `<ActivityTab>` (`components/admin/ActivityTab.tsx`) wired into all 12 artifact edit pages (post, collateral, service, solution, case-study, application, model, polaris-episode, white-paper, workshop, event, team-member).~~
- ~~Daily prune job in `lib/scheduler.ts` honoring `siteSettings.auditLogRetentionDays` (default 365), with `auth.%` / `oauth.%` / `session.%` actions held for 5 years.~~
- ~~`/admin/access/security-log` now reads from `/cms/audit-log?actionPrefix=auth.`; the old `routes/cms/securityLog.ts` was deleted.~~

---

## Marketing & Lifecycle

### ~~#83 · Gated download CTA for white papers~~ **— Dropped May 2026 (handled by HubSpot)**
**Depends on:** —

~~White paper detail pages currently offer a plain download button. For lead generation, high-value white papers should require a visitor's name and email before delivering the file.~~ **Dropped from scope:** white-paper lead-gen gating is handled by HubSpot forms / landing pages, which already own the form capture, list membership, and nurture flow. An in-app gate would duplicate the CRM-side capture and split the lead record. No in-app work planned.

### ~~#85 · Upcoming webinar registration rail~~ **— Dropped May 2026 (handled by Teams webinar)**
**Depends on:** —

~~Every webinar in the collateral library is currently treated as a past on-demand recording. This task adds an "upcoming" state with an inline registration form.~~ **Dropped from scope:** upcoming-webinar registration is handled by Microsoft Teams webinar (registration page, confirmation + calendar invite, attendee management). The library continues to host the on-demand recording after the event; no in-app registration rail will be built.

### #86 · Fix OG tags for social link previews — **Infrastructure shipped, production data not populated**
**Depends on:** —

The serving path is fully shipped: default OG tags are embedded in `artifacts/synozur/index.html`; `artifacts/api-server/src/middlewares/socialBotRenderer.ts` detects social crawlers by User-Agent and serves per-page values via the server-side `/api/og?path=` endpoint; the dynamic sitemap and `Sitemap:` directive are wired through `artifacts/api-server/src/routes/seo.ts`.

**Open work — data backfill (May 2026 verification):** the per-page values themselves (`seoTitle`, `seoDescription`, `ogImage` on the artifact rows) are mostly **blank in the production database**, which means the bot middleware resolves to the global defaults from `site_settings` (`seoDefaultTitleTemplate`, `seoDefaultDescription`, `seoDefaultOgImageUrl`) on virtually every URL. Functionally a shared link previews with the same title and image regardless of which insight, case study, application, or solution is being shared. This is a content-side gap, not a code gap.

Resolution path:
- Run `POST /api/seo/audit` against production to enumerate every published artifact missing one of `seoTitle` / `seoDescription` / `ogImage`. The audit code is shipped at `artifacts/api-server/src/lib/seoAudit.ts`.
- For high-volume artifacts (insights, case studies, applications, solutions, services, white papers, models), run `POST /api/seo/audit/autofill` to populate suggestions; the autofill helper never overwrites editor-set values, so it is safe to re-run.
- Editorial review pass on the autofill output before flipping the audit from warn to block.
- For OG images specifically: until the dynamic OG image generator (#161) lands, either (a) seed each artifact kind's `ogImage` from a kind-specific default set in `site_settings`, or (b) authoritatively author one OG image per top-30-traffic artifact during the launch sprint.

**Resolver coverage gaps closed (May 2026):** the bot-side `ogResolver.ts` was extended to dynamic-render OG images for `services`, `solutions`, `applications`, `models`, and `workshops` (previously these always resolved to the global default image); to surface `imageUrl` on `/team/:slug`; and to fill the missing description on `/library/:slug` and `/webinars/:slug` from `collateral.subtitle` / `collateral.description`. The same patch fixed a silent pre-existing bug where `loadSiteDefaults` selected a non-existent `seoDefaultOgImageUrl` column and quietly fell through to the hard-coded `/images/hero-bg.png` on every request — the resolver now joins through `seoDefaultOgImageMediaId → mediaTable`. `OG_TEMPLATE_VERSION` was bumped to `4` (api-server and the synozur helper) for the new kinds. The remaining work is purely the data-side autofill / hand-author pass above.

Tracked as a launch-readiness item (L7 above).

### ~~#102 · Connect search engine submission to live credentials~~ **— Shipped May 2026**
**Depends on:** #97 (SEO / search engine submission)

The IndexNow, Google Indexing API, and Bing Webmaster Tools submission feature is fully implemented but gated behind environment variables that have not been set in production. Until these are configured the submit endpoint always returns `ok: false` for every channel. This task configures the live credentials in the production environment and verifies that newly published or updated content triggers real indexing submissions to all three search engines.

Shipped: all three submission channels (IndexNow, Google Indexing API, Bing Webmaster) are wired in `artifacts/api-server/src/lib/seoSubmit.ts` and the per-channel configuration state is surfaced at boot and via the `/admin/site-config/launch-readiness` page (also tracked under L3). Setting the production env vars + a verifying publish remains an ops checklist item under L3.

### #132 · SendGrid integration for marketing email and deliverability redundancy
**Depends on:** — (can ship independently); pairs with #131 (HubSpot lead capture)

Today all outbound mail — contact-form confirmations, newsletter double-opt-in, start-inquiry replies, comment moderation pings, scheduled-post notifications — goes through **Resend** via a thin client in `artifacts/api-server/src/lib/email/`. Resend is excellent for low-volume transactional flows but the roadmap brings two demands it isn't well-suited to: (a) larger marketing sends to the newsletter and Insights subscribers as the audience grows, and (b) deliverability redundancy so a single provider outage doesn't silently break sign-ups, password resets, and SSO invitations. This task adds **SendGrid** alongside Resend behind a provider abstraction, with an admin-controlled routing policy that picks the right provider per message class.

Scope:
- **Provider abstraction.** Refactor `artifacts/api-server/src/lib/email/` to an `EmailProvider` interface (`send(message)`, `sendBulk(messages)`, `addToList`, `removeFromList`, `getEvent(messageId)`). Keep the existing Resend driver, add a SendGrid driver over `/v3/mail/send` and `/v3/marketing/contacts`. Existing call sites (form handlers, comment moderation, scheduled-post worker) keep their current API surface unchanged.
- **Routing policy.** Site-settings rows hold a `messageClass → provider` map (`transactional` → Resend, `marketing` → SendGrid, `system` → Resend, `bulk_announcement` → SendGrid) plus a `failoverProvider` per class. The router applies the policy at send time; a provider failure (5xx, 429 with no retry-after success, timeout) automatically retries on the failover provider and emits a `email.failover_triggered` audit event so admins notice persistent issues.
- **Marketing list sync.** Newsletter subscribe and unsubscribe flows write to a SendGrid Marketing Contacts list (one list per audience class — `newsletter`, `insights_digest`, `event_invites`) in addition to the existing internal `subscribers` table. Unsubscribe webhooks from SendGrid (`/webhooks/sendgrid`) flip the local row to `unsubscribed` so the audit trail matches.
- **Event ingestion.** SendGrid Event Webhook (delivered, opened, clicked, bounced, dropped, spamreport, unsubscribe) hits a new `/webhooks/sendgrid/events` endpoint, signed-payload verified, and rows land in an `email_events` table keyed by message id. The same table accepts the equivalent Resend events so admins see a unified timeline regardless of provider. When #131 ships, opens/clicks on marketing sends also emit a `synozur_email_engaged` HubSpot timeline event.
- **Authentication & deliverability.** Document and script DNS for SPF, DKIM (per-provider selectors so both providers sign in parallel), and DMARC alignment in `docs/email-domain-verification.md`. Add a `/admin/integrations/email/health` page that pings each provider's domain auth status and surfaces deliverability KPIs (bounce rate, spam rate, IP/domain reputation when exposed by the provider).
- **Templates.** Migrate the existing Resend HTML templates into a shared `email-templates` package rendered by both drivers (MJML or plain Handlebars — pick during implementation), so the same template renders identically regardless of which provider sends it.
- **Configuration.** `SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_PUBLIC_KEY` in env; sender identity (`SYNOZUR_FROM_EMAIL`, `SYNOZUR_FROM_NAME`) shared across providers; per-message-class provider mapping editable under `/admin/integrations/email`.

Out of scope: replacing HubSpot's own marketing-email engine (HubSpot keeps its lifecycle nurtures), drag-and-drop visual template editor, list-of-lists segmentation UI. Follow-up: wire the `email_events` table into the contact's HubSpot timeline so sales sees a single engagement view across web activity (#131) and email engagement.

### ~~#228 · Centralized multi-property traffic reporting~~ **— Shipped May 2026**
**Depends on:** —

The traffic dashboard is now a hub that aggregates web traffic across any Synozur web property. Shipped: `traffic_properties` registry (id, slug, name, baseUrl, hashed apiKey, isDefault, isActive) seeded with the built-in `synozur` (default) and `wix-legacy` rows, with `traffic_sessions.source_system` / `traffic_pageviews.source_system` backfilled to those slugs; admin CRUD at `/admin/marketing/traffic/properties` (one-time API-key reveal, rotate-key, deactivate); authenticated `POST /api/traffic/ingest` accepts `{ propertySlug, sessions[], pageviews[], events[] }` batches with shared Zod schemas, idempotent `(source_system, external_session_key)` upserts, per-property rate limiting, and clear 4xx errors; `/admin/marketing/traffic/import` page accepts JSON or CSV (with column-mapping step + sensible Wix/GA defaults) routed through the same normalizer with an accepted/skipped/duplicates/errors summary and per-property import-run records; `/cms/traffic/*` filter switched from `sourceSystem: native|legacy|all` to `propertySlugs: string[]` (defaulting to `['synozur']` for self-only) honored by overview, pages, sources, AI-crawlers, and CSV export; the dashboard renders a property multi-select with URL-persisted state and per-property breakdown cards when more than one property is selected. Server tests cover ingest auth/validation/idempotency/rate-limits, importer parsing/idempotency, and property-filtered reporting.

### #140 · Experimentation framework + conversion-funnel analytics
**Depends on:** — (additive); pairs with #131 (HubSpot identity) for funnel attribution and #130 (theme switcher) as a likely first experiment

The site is heavily instrumented for traffic (GA4, LinkedIn, Meta pixels) but has no first-party experimentation framework, no funnel view of how visitors move from landing → service → contact, and no way to A/B-test hero copy, CTA placement, or pricing surfaces with statistical rigor. Today every product/marketing change ships as a one-way hypothesis. This task adds:
- **Experiment definition + assignment.** Self-hosted GrowthBook (or PostHog if we want session replay alongside — decide during implementation). Experiments are defined in the admin UI under `/admin/marketing/experiments` with name, hypothesis, variants, traffic allocation, targeting (route, audience class, geo), primary metric, guardrail metrics. SDK on the client (`useExperiment(key)`) returns the assigned variant; assignment is sticky-by-anonymous-id pre-auth and sticky-by-user-id post-auth so visitors don't see flickering when they sign in.
- **Funnel definition.** Each experiment can attach to a named funnel — e.g. `landing → /services → /services/:slug → contact_form_submit`. Funnels are defined as sequences of GA4-mirrored events; the admin shows current conversion at each stage and per-variant lift with confidence intervals.
- **Server-side flag evaluation.** API routes can also flip behavior on flags (e.g. testing alternate Resend templates) so experiments aren't limited to UI variants.
- **Identity bridge.** When a visitor authenticates or submits a form, the anonymous experiment id is bridged to the HubSpot contact (#131) and becomes a contact property, so sales sees which variants the lead saw before converting.
- **Guardrails.** A small set of always-on guardrail metrics (page-load time, error rate, bounce rate) automatically halt experiments that regress beyond a threshold; halts post to the audit log and email the experiment owner.
- **Documentation.** A short experiment-design guide in `docs/experimentation.md` with templates for hypothesis writing, sample-size calculation, and a "kill criteria" checklist.

Out of scope: multi-armed bandits (start with frequentist A/B), causal-inference observational studies. Follow-up: wire experiment assignment into the cross-app switcher (#129) so we can A/B test Galaxy / portal entry points in one place.

### ~~#168 · Double opt-in confirmation for newsletter subscribers~~ **— Shipped May 2026**
**Depends on:** — (additive); pairs with #132 (the confirmation email is itself a transactional send) and #131 (HubSpot — DOI confirmation now gates the contact upsert)

`/forms/subscribe` (`artifacts/api-server/src/routes/forms.ts:499`) currently writes the submission, sends a marketing welcome via Resend, and enqueues a HubSpot contact upsert *all in one synchronous request* — there is no confirmation step. Anyone (or any bot that gets past Turnstile) can sign up an arbitrary third-party email, and a competitor flooding the endpoint with executive addresses can poison our sender reputation overnight. GDPR (Recital 32 — "clear affirmative action") and CASL effectively require an explicit confirmation event for marketing email; today the audit trail captures only IP + UA + timestamp at submit, not at confirm.

This task adds **double opt-in (DOI)**:
- **Schema.** New `subscribers` table — `email` (unique), `status: 'pending' | 'confirmed' | 'unsubscribed'`, `confirmation_token_hash`, `confirmation_sent_at`, `confirmed_at`, `confirmed_ip`, `confirmed_user_agent`, `unsubscribed_at`, `created_at`. Resubmission while `pending` rotates the token but doesn't multiply rows; resubmission while `confirmed` is a no-op.
- **Submit path.** `/forms/subscribe` writes the row as `pending` and sends a "Confirm your subscription" email via Resend with a signed link to `/subscribe/confirm?token=…`. Token signing reuses the HMAC pattern from `lib/unsubscribeToken.ts` — single helper, single secret rotation story.
- **Confirm path.** `GET /forms/subscribe/confirm?token=…` validates the signature, checks `confirmation_sent_at` is within a 7-day TTL, flips `status='confirmed'`, records the confirming IP / UA / timestamp, **and only then** enqueues the HubSpot contact upsert (`enqueueContactSubmission`) and the welcome marketing send. The page renders a success message with a one-click unsubscribe link for symmetry.
- **Existing newsletter touchpoints** (RSS-driven digests once they ship, scheduled-post notifications) gate sends on `subscribers.status='confirmed'`; pending rows never receive marketing.
- **Admin surface.** A "Pending confirmations" tab under `/admin/marketing/subscribers` showing pending vs. confirmed funnel + a manual resend-confirmation action for support cases. A 30-day pending-cleanup cron deletes rows that never confirmed.
- **Re-confirmation pass.** A one-shot `scripts/sendReconfirmationCampaign.ts` mails the existing pre-DOI subscriber list once with a "confirm to keep receiving" CTA; non-confirmers stay opted-in for transactional but get pulled from marketing lists.

Out of scope: per-list DOI (newsletter / insights digest / event invites all share one confirmation today; revisit when #132 SendGrid lists materialize). Follow-up: surface the per-source confirm-rate funnel inside #140 so we can compare DOI conversion across landing pages.

### ~~#220 · Send branded transactional email through SendGrid~~ **— Shipped May 2026**
**Depends on:** — (precursor to #132 / #221 deliverability work)

Transactional email previously went through Resend via a thin direct-REST call. Shipped: the API server's transport in `artifacts/api-server/src/lib/email.ts` was rewritten to use `@sendgrid/mail` via the new `getUncachableSendGridClient()` helper in `artifacts/api-server/src/lib/sendgridClient.ts`, which reads credentials per-call from the Replit SendGrid connector (`connectors.replit.com/api/v2/connection?connector_names=sendgrid`) and throws a typed `SendGridNotConfiguredError` when the connector is unbound — mapped to `{ status: "skipped" }` so missing-connector environments stay graceful. The branded purple-gradient shell, preheader handling, plain-text fallbacks, unsubscribe-token flow, and every call site (`routes/forms.ts`, `routes/auth.ts`, `routes/cms/comments.ts`) are unchanged. `EMAIL_FROM` remains an optional `"Display Name <addr@example.com>"` override; the unused `RESEND_API_KEY` constant was dropped.

---

## Public Site UX

### ~~#84 · Seed & verify 301 redirects from Wix~~ **— Shipped (seeder); production verification ongoing**
**Depends on:** —

~~When the site migrated from Wix most content paths changed, so visitors following old links and Google's crawl index hit 404s.~~ **Shipped:** seeder lives at `artifacts/api-server/src/scripts/seedWixRedirects.ts` and ingests the three rule sources (Wix CSV, sitemap-derived rules, hand-authored rules) into `wix_redirects`; admin CRUD at `/admin/site-config/redirects.tsx`. Hit counters confirm the middleware is live. Remaining residual: a one-time spot-check pass against production logs to confirm zero high-traffic 404s map to a missing redirect — track this under #163 below.

### ~~#133 · Constellation interactive demo sandbox on /applications/constellation~~ **— Shipped May 2026**

Shipped: `artifacts/synozur/src/components/demos/constellation/` is a step-driven module with URL-routable steps (`?step=dashboard|narrative|risk|outlook|complete`), wired into `pages/application-detail.tsx` for `slug === "constellation"`. Server-side narrative endpoint at `GET /api/demos/constellation/narrative?seedId=` (`artifacts/api-server/src/routes/constellationDemo.ts`) generates the executive summary via Claude (`claude-sonnet-4-6`) grounded on the shared fixture (`artifacts/api-server/src/lib/constellationDemoSeed.ts` + `artifacts/synozur/src/data/constellation-demo-seed.ts`), with a 24h in-memory cache and per-seed in-flight coalescing so concurrent visitors share a single generation. Telemetry: every step view + the simulated Outlook send + the full-loop completion emit `synozur_application_demo_requested` to GA4/dataLayer with `app=constellation, depth=partial|full`, and mirror to `POST /api/demos/constellation/event` for log-side observability when ad-blockers strip GA4. A/B toggle layers the per-visitor URL override (`?demo=on|off` with sessionStorage stickiness) on top of an admin-controlled `siteSettings.constellationDemoEnabled` kill-switch flag (toggle in `/admin/site-config/site-settings`); revisit when #140 ships proper bucketing. Anonymous depth=full completions persist to `application_demo_completions` keyed by an opaque `syn_visitor` cookie; when the visitor later submits the contact form, `flushPendingDemoCompletionsForVisitor` enqueues the HubSpot timeline event so the funnel handoff stays intact for the no-sign-in path. Out of scope: a real free-tier login, and demos for the other five applications (apply the pattern in follow-up tasks once Constellation proves the format).

### ~~#134 · "Ask Synozur" — Vega-pattern grounding documents + retrieval over the editorial corpus~~ **— Shipped (#262); FTS-only phase 0, vector retrieval deferred**

Shipped via task #262: grounding-document admin (`/admin/ai/grounding`), `buildSystemPrompt()` integration in `/api/ai/chat`, an editorial-corpus indexer (`editorial_chunks` with title-weighted tsvector + GIN), the `searchEditorialCorpus()` retriever, public `/insights/ask` SSE surface with cited sources, and `/admin/insights/questions` telemetry (top questions, refusal rate, low-confidence rate, click-throughs). Phase-0 retrieval is Postgres FTS only — the `editorial_embeddings` `vector(1536)` leg is deferred until an embeddings provider is wired (no current Replit AI Integrations support); the schema column `embedding_model_version` is reserved on `editorial_chunks` so vector similarity can join in without a migration. See follow-up below.

#### Original task description (preserved)

**Depends on:** — (data is already in the CMS); pairs with #122 (multi-resource attachments give richer source material) and #131 (intent capture)

The site has accumulated a real corpus of editorial content — Insights posts, Polaris episode notes, white papers, case studies, FAQ — but visitors can only find it by browsing or search-by-title. They can't ask the corpus questions like "what does Synozur recommend for AI rollouts in financial services?" or "have you done a Constellation engagement in the public sector?" and get a grounded, cited answer. This task adds a public Q&A surface backed by **two complementary subsystems** that mirror how Vega grounds its AI assistant:

**(1) Grounding documents — Vega pattern, ported verbatim.** Standalone admin-authored documents that get **injected wholesale into the system prompt on every AI call** (no chunking, no embeddings — the whole document goes in). New `grounding_documents` table modeled on Vega's `shared/schema.ts`:

- `id uuid pk`, `title text not null`, `description text`, `category text not null`, `content text not null`, `priority integer default 0`, `is_active boolean default true`, `created_by`, `created_at`, `updated_by`, `updated_at`.
- **Categories** (driven by an enum that maps to prompt section headers, exactly as Vega does):
  - *Instructional:* `methodology`, `best_practices`, `terminology`, `examples`
  - *Contextual:* `about_synozur` (parallel to Vega's `company_os`), `brand_voice`, `audience_personas`
- **Scope.** The Synozur public site is single-tenant, so we drop Vega's `tenantId` column and replace it with optional `scope_tags jsonb` (audience class / sector / application) for filtered injection — null tags = always inject. No `is_tenant_background` flag needed; `is_active` is sufficient.
- **Server-side file parsing for editor uploads** (matches Vega's `/api/ai/parse-pdf` and `/parse-docx` endpoints): `POST /api/ai/parse-pdf` and `POST /api/ai/parse-docx` accept raw binary, return extracted text via `pdf-parse` and `mammoth`, and the admin UI pastes the result into the `content` field — keeps heavy parsing libraries out of the browser bundle.
- **Prompt construction.** New `buildSystemPrompt(scopeTags?)` server util fetches `is_active=true` documents that match the scope (or are unscoped), orders by `priority desc, category asc`, and formats each as `### <CategoryLabel>: <title>\n<content>` joined with double-newlines — identical formatting to Vega's `buildSystemPrompt`. A `getSimpleCompletion()` escape hatch (also matching Vega) skips grounding for lightweight calls like rewriting or scoring where the full corpus would just burn tokens.

**(2) Editorial corpus retrieval — separate RAG layer the model calls as a tool.** Wholesale injection works for ~10–30 grounding docs but not for 200+ Insights posts and case studies. So the *grounded answer* still comes from retrieval, exposed to Claude as a tool:

- `pgvector` + an `editorial_embeddings` table (`source_kind`, `source_id`, `chunk_index`, `text`, `embedding vector(1536)`, `model_version`, `updated_at`). A backfill worker chunks every published Insights post, case study, white paper, FAQ entry, and Polaris show-notes row into ~500-token chunks. Re-embedding triggers on publish/update via existing artifact lifecycle hooks.
- A `searchEditorialCorpus(query, filters)` Claude tool runs hybrid retrieval (vector + BM25 over `collateral.title/excerpt`) and returns ranked passages with source metadata for citation.
- The system prompt (built from grounding documents) instructs the model *when* to call this tool and how to format inline citations.

**Public surface.** New `/insights/ask` page with streaming responses, session-scoped conversation history (not persisted unless the user authenticates), and per-answer source cards. Also embedded as a discovery widget on the Insights index page. Refusal path returns a "we don't have published material on that — talk to a human?" CTA wired to the contact form.

**Admin surfaces.**
- `/admin/ai/grounding` — Vega-style list view (sorted by priority desc, then category) with the standard CRUD form, file upload, and a per-row active toggle. RBAC gated on a new `MANAGE_AI_GROUNDING` permission granted to admins and editors.
- `/admin/insights/questions` — every question + retrieved sources + final answer logged (PII-redacted), surfacing top questions, click-through to sources, refusal rate, a "low retrieval confidence" report flagging questions where the editorial corpus came up empty, and a "create insight on this topic" shortcut.

Out of scope: multi-tenant grounding scope (single-tenant for now), open-ended chat memory across sessions, fine-tuning, multi-language Q&A (English first; revisit after #139), live foundation-data injection (Vega pulls live mission/vision/values; on this site that role is filled by the `about_synozur` grounding category, edited as a normal document). Follow-up: pipe high-intent questions ("how do I buy / start") to the Astra concierge for a soft hand-off.

### ~~#138 · Stop pillar overview pages from competing with service pages on Google~~ **— Shipped (canonical hint); Search Console verification pending**
**Depends on:** #55 (services hierarchy public pages)

~~The route `/services-overview/:slug` and `/services/:slug` render overlapping content and metadata for the same service pillar~~ **Shipped:** `artifacts/synozur/src/pages/services-overview.tsx` now emits a canonical hint pointing to the authoritative service-detail URL (lines 7–11). Residual: a Search Console Coverage report sweep to confirm Google has consolidated indexing on the canonical URL — fold into the SEO submission verification under #102.

### ~~#154 · Ship a Web App Manifest (PWA) for the public site~~ **— Shipped May 2026**
**Depends on:** —

~~The site has no `manifest.webmanifest` / `manifest.json`, so installing the site as a PWA falls back to browser defaults and the `theme-color` / `display` / app-icon set is empty.~~ **Shipped:** `artifacts/synozur/public/manifest.webmanifest` declares Synozur name/short name, cosmic-navy `#0a0a19` brand background + theme color, `display: standalone`, `start_url: /`, an icon set (`/icon-192.png`, `/icon-512.png`, plus `/icon-maskable-512.png` with the brand-color safe-zone padding) generated from the existing brand mark, and two wide-form-factor screenshots. `artifacts/synozur/index.html` emits `<link rel="manifest">`, `<meta name="theme-color" content="#0a0a19">` (with a `prefers-color-scheme: dark` companion), and the iOS `apple-mobile-web-app-*` meta set so Safari Add-to-Home-Screen lands a branded icon and a black-translucent status bar. The SPA static server (`server.mjs`) was extended with the `application/manifest+json` MIME type so `/manifest.webmanifest` is served with the correct content-type. Service-worker / offline support remains out of scope (deferred follow-up).

### ~~#155 · Add security headers via `helmet` in the API server~~ — **Shipped (PR #68)**
**Depends on:** —

~~The Express API at `artifacts/api-server/src/app.ts` does not emit a Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy header.~~ **Shipped:** `helmet` wired into `artifacts/api-server/src/app.ts` via `artifacts/api-server/src/lib/securityHeaders.ts` — emits HSTS (2yr + preload), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy, and CSP in `Content-Security-Policy-Report-Only` mode. The same header set is applied to every public HTML response in `artifacts/synozur/server.mjs`. CSP allowlist covers GA4, LinkedIn Insight Tag, Meta Pixel, Cloudflare Turnstile, YouTube, Microsoft Bookings, Google Fonts, and Libsyn. Violations are deduplicated into the `csp_violations` table via `POST /api/csp/report` (rate-limited, two payload shapes accepted). Admin dashboard at `/admin/site-config/csp-violations` (Site Config nav section, PR #68) lets operators filter by directive, inspect hit counts, and delete resolved rows. The dashboard also surfaces an enforce-readiness verdict (`ready` / `monitoring` / `blocked` / `no-data`) backed by `GET /api/cms/csp/readiness` (PR #71, `artifacts/api-server/src/routes/cms/cspViolations.ts`), computed from days-since-last-violation against a configurable 7-day clean window; it also exposes `GET /api/cms/csp/directives` (distinct violated-directive list for the filter dropdown) and `DELETE /api/cms/csp/violations` (bulk-clear). Set `CSP_ENFORCE=1` to promote from report-only to enforcing once the readiness banner shows `ready`.

### ~~#156 · Make Lighthouse CI block PRs instead of running on manual trigger~~ **— Shipped May 2026**
**Depends on:** —

~~`.github/workflows/quality.yml` runs `lhci autorun` only under `workflow_dispatch`.~~ **Shipped:** a new `lighthouse` job in `.github/workflows/quality.yml` runs on every `pull_request` and `push: main`, boots the postgres + api-server + synozur preview stack, executes `pnpm exec lhci autorun --config=./lighthouserc.json`, uploads the HTML report as the `lighthouse-report` workflow artifact, and posts a sticky PR comment (header `lighthouse-ci` via `marocchino/sticky-pull-request-comment@v2`) summarizing per-route Perf / A11y / Best-Practices / SEO scores plus any blocking failures. `lighthouserc.json` was rewritten with `assertMatrix` so the five clean routes (`/`, `/about`, `/services`, `/insights`, `/contact`) gate at `error` for all four categories while `/library` and `/applications` stay at `warn` pending the SEO/perf cleanup tracked elsewhere. The summary script lives at `scripts/src/lighthouse-pr-summary.ts` and is run via `pnpm --filter @workspace/scripts run lighthouse:pr-summary`. A README badge links to the latest run. Pairs naturally with the warn → hard-mode flip in BACKLOG.md "Quality gates" #3.

### ~~#157 · CI broken-link checker over the published site~~ **— Shipped May 2026**
**Depends on:** #156 (lands alongside the PR-blocking Lighthouse run)

Shipped: a new `Broken-link check` workflow (`.github/workflows/link-check.yml`) boots postgres + api-server + the synozur production server (`artifacts/synozur/server.mjs`, not `vite preview`, so route-status 404/410 gating and the `wix_redirects` middleware are exercised the same way they ship) and runs `pnpm --filter @workspace/scripts run link-check` (`scripts/src/link-check.ts`). The script seeds the crawl from `${baseUrl}/sitemap.xml` (recursing one level into nested sitemap indexes and filtered to same-origin URLs) plus a hand-curated set of well-known surfaces (`/`, `/about`, `/services`, `/solutions`, `/applications`, `/case-studies`, `/insights`, `/library`, `/contact`, `/privacy`, `/terms`). `linkinator` then crawls with `recurse: true`, follows redirects so the `wix_redirects` middleware doesn't false-positive, and stops at first hop for external links. Per-page totals are bucketed 200 / 30x / 4xx / 5xx / skipped / allowlisted and emitted to `.link-check/results.json` + `.link-check/summary.md`, with a per-page table for any page that has non-200 results. PRs gate on **new** broken links vs. the latest main-branch baseline (downloaded via `dawidd6/action-download-artifact` from the `link-check-baseline` artifact); pre-existing breakage is shown in a collapsed `<details>` block but does not fail the PR. Push:main republishes that baseline (90-day retention). Nightly cron + workflow_dispatch failures open / refresh a tracking GitHub issue (label `link-rot`) via `actions/github-script`. Allowlist at `.github/link-check-allowlist.yml` uses `pattern` (JS regex via `RegExp.test()` — substring match unless caller anchors with `^…$`) + `reason` + `expires` (YYYY-MM-DD); expired entries always fail the build.

### ~~#158~~ · ~~Add `eslint-plugin-jsx-a11y` and a pre-commit a11y/SEO gate~~ — **Shipped (#235)**
**Depends on:** —

~~The codebase has axe-core integration in the Playwright suite but no static a11y linting. `eslint-plugin-jsx-a11y` would catch the bulk of the same issues at edit time — missing alt text, invalid ARIA, label-input mismatches, anchor-without-href — long before Lighthouse or axe can.~~ **Code shipped:** `eslint.config.js` (flat config) at the workspace root scopes the new rules to `artifacts/synozur/src/**` and ignores api-server / galaxy / mockup-sandbox / lib / scripts / tools so the gate lands incrementally on the public + admin surfaces. Must-have rules (alt-text, anchor-is-valid, aria-props, aria-role, label-has-associated-control, no-noninteractive-element-interactions, no-static-element-interactions) run at `error`; stylistic rules (anchor-has-content, click-events-have-key-events, heading-has-content, etc.) at `warn`. The 67 violations the initial run surfaced were fixed by refactoring the wouter `<Link><a>...</a></Link>` pattern to `<Link className data-testid>...</Link>` (Wouter v3 forwards props to the rendered `<a>`), turning the footer's placeholder social `<a href="#">` into `<button>`s, and documenting the genuinely-contextual exemptions inline (Radix-wrapped labels, native HTML5 DnD reorder regions, the synozur app-switcher's current-tile menuitem). `pnpm run lint` and `pnpm run lint:fix` scripts live in the root `package.json`; `lint-staged` runs `eslint --max-warnings=0` on staged TSX, wired through a Husky pre-commit hook (`.husky/pre-commit`) and `prepare: "husky || true"`. CI gets a new `Lint (eslint + jsx-a11y)` step in `.github/workflows/quality.yml` before the existing typecheck/build job so author-time regressions block PR merge.

### ~~#159 · Expand JSON-LD schema coverage (LocalBusiness, Person, Review, VideoObject)~~ **— Shipped May 2026**
**Depends on:** —

~~The site emits Organization, Article, FAQPage, BreadcrumbList, and Event JSON-LD today, but several artifact types still rank weaker than they could because their structured data is incomplete.~~ **Shipped:** four new components in `artifacts/synozur/src/components/` — `local-business-jsonld.tsx` (emitted on `/contact`, sourced from `site_settings` org address fields with hard-coded geo/opening-hours defaults for the Mill Creek WA office), `person-jsonld.tsx` (emitted on `/team/:slug` with jobTitle, image, and `sameAs` LinkedIn / website links from the existing team profile fields), `video-jsonld.tsx` (emitted on `/videos/:slug` and `/polaris/:slug` with `uploadDate`, ISO-8601 `duration` via `secondsToIsoDuration`, `thumbnailUrl`, `contentUrl`, and `embedUrl`), and `review-jsonld.tsx` (Review + AggregateRating wrapper on the `/clients` testimonials block). The existing `article-jsonld.tsx` learned an `isNews` prop and `insight-detail.tsx` opts a post into `NewsArticle` when its tags or categories include `news`. Each schema renders a single managed `<script id>` so no stacking occurs across SPA navigations.

### ~~#160 · Search Console domain-property verification + indexing dashboard~~ **— Shipped May 2026** (code; DNS/property verification is ops, tracked under L2)
**Depends on:** #102 (live search-engine submission credentials)

~~Production verification with Google Search Console and Bing Webmaster Tools … This task: (a) adds verification meta tags keyed off env variables, (b) confirms DNS TXT verification, (c) builds an internal `/admin/marketing/seo-coverage` page that reads the Search Console URL Inspection API + Bing Webmaster API on a daily cron and surfaces "indexed", "discovered — not indexed", "crawl error", and "soft 404" buckets per artifact type.~~ **Shipped:**

- **(a)** already shipped earlier: `artifacts/synozur/server.mjs` splices `<meta name="google-site-verification">` / `<meta name="msvalidate.01">` from `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` at boot (see launch-readiness L2).
- **(b)** is an ops task (registrar DNS TXT + property re-verification after the Wix cutover) — remains tracked under L2; no code component.
- **(c) shipped:** new `seo_coverage_status` + `seo_coverage_runs` tables (idempotent migration step 55 in `lib/migrations.ts`); core scanner `artifacts/api-server/src/lib/seoCoverage.ts` reuses the sitemap's `collectEntries()` URL set, calls the Google **Search Console URL Inspection API** (reusing the #102 `GOOGLE_INDEXING_SA_JSON` SA with the `webmasters.readonly` scope + new `GOOGLE_SEARCH_CONSOLE_SITE_URL` property var) and the Bing Webmaster **GetUrlInfo** API (reusing `BING_API_KEY`/`BING_SITE_URL`), with pure unit-tested bucket normalizers in `seoCoverageBuckets.ts` (`pnpm --filter @workspace/api-server run test:seo-coverage`, 14 cases). Every provider is opt-in and degrades gracefully like `seoSubmit.ts`. A daily cron in `lib/scheduler.ts` (20-min post-boot delay, then 24 h) refreshes rows and prunes URLs that are no longer published. Admin API `GET/POST /cms/seo-coverage*` gated on `content.moderate`; dashboard at `/admin/marketing/seo-coverage` (route + `AdminLayout` nav entry `nav-admin-marketing-seo-coverage`) renders per-artifact-type bucket counts, provider-config + last-run banner, drill-down by (kind, bucket), and a **Rescan now** button. Env vars documented in `docs/seo-env.md` (Step 4). **Remaining ops:** set `GOOGLE_SEARCH_CONSOLE_SITE_URL` (and confirm the SA is a Search Console user) in production, then verify a scan populates buckets — folds into the L2 ops checklist.

### ~~#161 · Dynamic OG image generation for insights, case studies, and Polaris episodes~~ — **Shipped May 2026**
**Depends on:** —

~~`/api/og?path=` returns a static HTML preview today; OG images themselves are author-uploaded statics or fall back to the global default. Auto-generated, on-brand OG images per article would lift social CTR without adding production work for editors. This task adds a `/api/og/image?kind=&id=` endpoint on the API server that renders a 1200×630 PNG using `@vercel/og` (or `satori` + `resvg`) with: the artifact title, author name and avatar, kind badge (Insight / Case Study / White Paper / Polaris), and the Synozur wordmark over the brand-gradient background. Cache the generated image in object storage keyed by `(kind, id, lastModified)` and serve it via a CDN-friendly URL referenced from each artifact's `<meta property="og:image">` when no explicit override is set. Editors can still upload a custom OG image to override the generated one.~~ Shipped via `artifacts/api-server/src/routes/og.ts` + `lib/ogImageRenderer.ts` (SVG → `sharp`, no new deps; `@vercel/og` was avoided because we already had `sharp` in the dependency tree) and `lib/ogImageCache.ts` (object-storage cache at `og-cache/{kind}/{id}/{updatedAtMs}.png` with in-memory LRU fallback). `lib/ogResolver.ts` falls back to the dynamic URL for `insights`, `case-studies`, `white-papers`, and `polaris` (the latter was previously not handled at all by the resolver) when neither `ogImage` nor `heroImage` is set; editor-set overrides still win and the social-bot middleware picks up the new URL automatically.

### ~~#162 · Use 410 Gone and 308 Permanent Redirect for unpublished and moved content~~ **— Shipped May 2026**
**Depends on:** —

~~When a published artifact is unpublished today, the route returns 200 with a `noindex` meta tag rather than the more correct 410 Gone — which is the explicit signal Google uses to drop the URL from the index quickly. Similarly, the Wix redirect middleware emits 301 / 302 only, never 308 (the version of 301 that preserves the request method, which matters when migrated POST endpoints are involved). This task: (a) updates the public artifact loaders to return HTTP 410 with a friendly body when the row has `status = 'archived'` or `unpublished_at < now()`, (b) extends the Wix redirect schema with a `status_code` column that supports 301 / 302 / 307 / 308 and surfaces the choice in the redirect admin UI, (c) tightens the sitemap exclusion logic so unpublished URLs are also actively removed from the sitemap on the next regeneration.~~ See L13 above for the shipped summary.

### ~~#163 · Tune robots meta directives and add a discovery-friendly 404 page~~ **— Shipped May 2026**
**Depends on:** —

~~Two related improvements that share a single PR. (a) The `Meta` component does not emit `max-snippet`, `max-image-preview`, or `max-video-preview` directives — the defaults Google applies are conservative and clip the rich SERP previews insights and case studies could otherwise earn. Adding `max-snippet:-1, max-image-preview:large, max-video-preview:-1` on indexable artifact pages is a one-line win. (b) `pages/not-found.tsx` is `noindex` but offers no escape route — no search box, no top-categories list, no "popular insights" tile. Visitors who land here from a stale link bounce. Add a small surface that surfaces the sitemap top-level sections, a search input that hits `/api/search`, and a "report this missing page" form that writes to the existing `not_found_logs` table for editor review.~~ **Shipped:** `artifacts/synozur/src/lib/meta.tsx` now emits `max-snippet:-1, max-image-preview:large, max-video-preview:-1` on every indexable page while preserving `noindex,nofollow` on auth/admin/unpublished routes. `artifacts/synozur/src/pages/not-found.tsx` was rebuilt as a discovery surface: top-section sitemap grid, popular-insights cards (via `useInsightsList`), a "report this missing page" form that re-posts to `/api/traffic/not-found`, and a search input that probes `/api/search` and hides itself when #170 hasn't shipped. Playwright coverage in `artifacts/synozur/tests/not-found.spec.ts` asserts the sitemap, popular-insights card, and the indexable-page robots directive.

### ~~#164 · Extend the event-detail share rail to insights, case studies, and white papers~~ **— Shipped May 2026**
**Depends on:** —

~~`event-detail.tsx` already ships a clean LinkedIn / Facebook / copy-link share rail (`facebookShare`, `share-linkedin` test id) — pure `<a href>` with pre-filled URLs, no third-party script, anchored below the hero. The same pattern is missing on `insight-detail.tsx`, `case-study-detail.tsx`, and `white-paper-detail.tsx`, which are the highest-volume editorial surfaces.~~ **Shipped:** the share cluster has been lifted into `artifacts/synozur/src/components/share-rail.tsx` with `kind` / `title` / `url` / `targets` props, rendering LinkedIn, X/Twitter, Facebook, copy-link, and a `navigator.share` mobile fallback (gated on capability detection so it hides on desktop and on browsers without `navigator.share`). The component is dropped under the hero on `insight-detail.tsx`, `case-study-detail.tsx`, and both render branches of `white-paper-detail.tsx`; `event-detail.tsx` was refactored to consume the same component without visual change. Playwright coverage in `artifacts/synozur/tests/share-rail.spec.ts` asserts the LinkedIn / X / Facebook hrefs are correctly URL-encoded on a real published insight post.

### ~~#165 · Honor `prefers-color-scheme` for first-time visitors~~ **— Shipped May 2026**
**Depends on:** —

~~Dark mode itself is shipped: `context/theme.tsx` exposes `useTheme()`, `components/ui/theme-toggle.tsx` renders the toggle, and the user's choice persists in `localStorage` under `synozur-theme`. The remaining gap is system-preference detection: `getInitialTheme()` only reads localStorage and falls back to a hard-coded `"dark"`, so a first-time visitor on a system set to light receives the dark canvas regardless of their OS preference.~~ **Shipped:** `getInitialTheme()` in `artifacts/synozur/src/context/theme.tsx` now reads `window.matchMedia("(prefers-color-scheme: light)")` when localStorage has no value, and `ThemeProvider` subscribes to the same media query's `change` event (using `addEventListener` with a Safari-compat `addListener` fallback) so the theme follows OS changes until the user explicitly toggles — once `synozur-theme` is set, the explicit choice wins. The pre-hydration script in `artifacts/synozur/index.html` mirrors the same precedence so first paint matches React's initial state, and a `<meta name="color-scheme" content="light dark">` tag is emitted so default form-control and scrollbar colors render correctly. The toggle stays binary — no tri-state.

### ~~#215 · Make the Alt Home (`/home-b`) hero, pillars, and closing CTA copy admin-editable~~ **— Shipped May 2026**
**Depends on:** —

The `/home-b` variant copy was hard-coded so editors could not test alternate headlines without a redeploy. Shipped: 17 new nullable `homeB*` text columns on `site_settings` (hero prefix/accent/suffix + subheadline, pillars eyebrow + headline, four pillar headline/body pairs, closing eyebrow/headline/body) defined in `lib/db/src/schema/siteSettings.ts` with idempotent startup migration #40 in `artifacts/api-server/src/lib/migrations.ts`. `routes/siteSettings.ts` round-trips the fields through public GET, admin GET, and PATCH (with trim/null-check); `lib/api-spec/openapi.yaml` exposes them on `PublicSiteSettings`, `SiteSettings`, and `SiteSettingsInput`. `pages/home-b.tsx` consumes the values via an `override(value, fallback)` helper so blank/null reverts to the original editorial copy and the hero splits prefix/accent/suffix to preserve the nebula-text accent. The admin Site Settings page gained an "Alt home page copy" section with grouped Hero / Pillars / Closing inputs, a single "Save Alt Home copy" button, and a "Reset all to defaults" action.

### ~~#216 · Admin-controlled homepage variant at `/`~~ **— Shipped May 2026**
**Depends on:** #215 (Alt Home copy fields)

`/home-b` was reachable but the root URL was wired to `Home` only, so promoting the alternate variant required a code deploy. Shipped: a new `home_root_variant` text column on `site_settings` (default `'a'`, constrained to `'a' | 'b'`) added via idempotent startup migration #41 in `artifacts/api-server/src/lib/migrations.ts`; `homeRootVariant` enum field plumbed through `lib/api-spec/openapi.yaml`, public + admin GETs, and PATCH `/admin/site-settings`. `App.tsx` introduces `RootHomeRoute` that renders `<Home/>` for `'a'` or `<HomeB/>` for `'b'`, with a dedicated `/home-a` route alongside the existing `/home-b`. The header's Home nav reads the same React Query cache and labels the alt link "Alt Home (A)" → `/home-a` or "Alt Home (B)" → `/home-b` based on which variant is active at `/`. The admin Site Settings page gained a "Homepage variant at /" two-button picker (`home-root-variant-a` / `home-root-variant-b`). Public site-settings response was switched to `Cache-Control: no-cache` so toggles propagate to visitors immediately.

### #139 · Internationalization foundation (English baseline + one launch locale)
**Depends on:** — (architecture); pairs with #110 (some audience classes will skew geographically), #130 (theme assets may need locale variants)

Every public string and every editorial CMS field on the site is English-only today. Enterprise procurement in EU and APAC stalls on this even when the buying team speaks English. This task lays the **i18n foundation** without trying to translate the entire corpus on day one:
- **Code-side i18n.** Adopt FormatJS (`react-intl`) inside `artifacts/synozur` with a build-time message-extraction step. Every string in the codebase moves to a `messages` catalog keyed by namespace; `en` is the baseline. Locale-routed URLs (`/de/insights/...`, `/ja/applications/constellation`) with a transparent default for `en` to avoid breaking existing links.
- **Content-side i18n.** Add a `locale` column + per-locale row strategy for translatable artifact fields on `collateral`, `services`, `solutions`, `case_studies`, `faq_items` — keyed (`canonicalId`, `locale`). The base row in `en` is canonical; per-locale rows are translations linked back. Admin UI gains a language switcher per editable field with a visible "translation lag" indicator (e.g. "EN updated 3 days after this DE translation").
- **Locale negotiation.** `Accept-Language` + explicit selector + persisted user preference (in `users.preferredLocale` for authenticated users, in localStorage for anon).
- **One launch locale.** Pick one (de or ja) for the first translation pass — translate the 30 highest-traffic public pages plus the four service pillars and the six application pages.
- **Translation workflow.** Integrate with Crowdin or Lokalise (decide during implementation) so external translators work in their native tooling rather than the admin UI; CI exports updated `messages.en.json`, fetches translated bundles, and writes them into `artifacts/synozur/src/locales/`.

Out of scope: right-to-left languages (separate pass), region-specific content (different case studies per locale — possible but not v1), multi-currency pricing. Follow-up: localize the Astra concierge and the Insights Q&A (#134) once the editorial corpus has enough translated content to retrieve from.

### ~~#166 · Lock down `/ai/chat` — auth, rate limits, conversation ACL, per-identity token budget~~ **— Shipped May 2026**
**Depends on:** — (must ship before #134 / Astra concierge expose any public surface)

**Shipped:** `POST /ai/chat` now requires either an authenticated session cookie or a Turnstile-gated anonymous chat session minted by `POST /ai/sessions/start` (cookie `aicid`, opaque token, SHA-256 stored in `ai_chat_sessions`). `conversations` and `messages` migrated to UUIDv7 PKs via a portable plpgsql `uuidv7()` function and a non-destructive backfill: the integer-serial PKs and the messages → conversations FK are rewritten in place with new uuid columns, and pre-#166 rows are stamped onto a single sentinel `ai_chat_sessions` row whose `revoked_at` is in the past so the rows are owned (passing the ACL invariant) but unreachable by any real caller. `conversations` gained `owner_user_id` / `owner_session_id` and every `/ai/chat` + `/ai/conversations/:id/messages` call enforces ownership (403 + `ai.chat.acl_denied` audit on mismatch). Per-IP (60/h), per-session (20/h), and burst (3/10s) limiters wrap `/ai/chat` and emit `ai.chat.rate_limited` audits. New `ai_chat_token_usage` daily-rollup table (per session / per IP / global) with caps from `siteSettings.aiChatDailyTokenCapPerSession` (default 50k) and `aiChatDailyTokenCapGlobal` (default 5M); breaches return 429 with `Retry-After` set to seconds-until-midnight-UTC, audit `ai.chat.budget_exceeded`, and global breach pages on-call via the structured-log alert hook. Prompt-injection guardrails strip role headers (`system:`/`assistant:`/`user:`/`developer:`/`tool:` and `<|role|>` styles) from user messages and clip prior history to 20 turns / ≈50k tokens; both fire `safety.suspected_injection` / `ai.chat.history_clipped` audits. Per-call `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheCreationTokens` are persisted onto the assistant `messages` row and rolled into the daily table. **Files:** `lib/db/src/schema/{conversations,messages,aiChatSessions,aiChatTokenUsage,siteSettings}.ts`, `artifacts/api-server/src/lib/aiChatSession.ts`, `artifacts/api-server/src/routes/aiChat.ts`, migration block in `artifacts/api-server/src/lib/migrations.ts`.

The AI chat infrastructure (`artifacts/api-server/src/routes/aiChat.ts`) is already mounted but is wide open in three independent ways:

1. **No authentication.** Anyone on the internet can `POST /ai/chat` with an arbitrary message and stream a Claude response on Synozur's Anthropic bill. There is no anonymous-session cookie, no Turnstile gate, no rate limiter on the route. A trivial script can drain the daily budget in minutes.
2. **No conversation ACL.** Conversations are keyed by integer primary key (`conversations.id`) with no `owner_user_id` or `owner_session_id` column. `GET /ai/conversations/:id/messages` returns the full message history for any id the caller asks for, so a curious visitor can walk `1, 2, 3 …` and read every chat anyone else has had — including the user-pasted PII that grounding-doc-driven Q&A typically attracts.
3. **No token budget.** There is no per-IP / per-user / global daily ceiling. Once #134 ships and the editorial corpus retrieval layer comes online, a single unhandled abuse pattern (long-context prompt injection, retry loops) can spike spend by 100× without any circuit breaker.

This task hardens the endpoint before any public surface lights it up:
- **Authn / session.** Require either an authenticated session cookie (`requireAuth`) or a server-issued anonymous chat session — `POST /ai/sessions/start` mints a signed cookie + persists a row in a new `ai_chat_sessions` table; the cookie binds to a session id, not just an IP, so VPN flips don't reset the budget. Turnstile gates `POST /ai/sessions/start` so bots can't trivially mint fresh sessions.
- **ACL.** Add `owner_user_id uuid null` and `owner_session_id uuid null` to `conversations` (one of the two is non-null per row). `GET /ai/conversations/:id/messages` and `POST /ai/chat` both check `owner_*` against the caller. UUIDv7 the table while we're at it — integer ids are an enumeration footgun on a public surface.
- **Rate limits.** Per-IP and per-session limiters using the existing `rateLimit({...})` pattern from `routes/insights.ts`: 20 messages/hour per session, 60/hour per IP, burst of 3 in 10 seconds. 429s emit `audit.action='ai.chat.rate_limited'`.
- **Token budget.** A new `ai_chat_token_usage` daily-rollup table counts input + output tokens per session / per IP / global. Hard cap at `siteSettings.aiChatDailyTokenCapPerSession` (default 50k) and `aiChatDailyTokenCapGlobal` (default 5M). Exceeding the cap returns a polite 429 with retry-after midnight UTC; global cap exceedance also pages the on-call.
- **Prompt-injection guardrails.** Strip `system:` / `assistant:` role headers from the user message before composing `chatMessages`; cap the total `priorMessages` window at 20 turns or 50k tokens (oldest dropped) so an attacker can't bloat the context with their own injected history. Surface a `safety.suspected_injection` audit event when guardrails fire.
- **Cost observability.** Log per-call `inputTokens` / `outputTokens` / `cacheReadTokens` (pairs with #167) into the rollup table so the Site Health dashboard can chart cost-per-day and per-session.

Out of scope: full content-moderation classifier (rely on Claude's own safety training for now); per-message PII scrubbing on storage (separate task once retention policy is decided). Follow-up: extend the same authn / budget envelope to a future `POST /ai/grounding/parse-pdf` endpoint when #134 lands the file-upload path.

### ~~#167 · Apply Anthropic prompt caching across the AI chat + grounding pipeline~~ **— Shipped May 2026**
**Depends on:** #166 (cost observability lands the metrics that prove the win); pairs with #134 (the corpus-retrieval tool layer benefits from the same pattern on its tool-use turn)

Shipped: marker-placement helpers live in `artifacts/api-server/src/lib/ai/promptCache.ts` (pure, unit-tested) and the route at `artifacts/api-server/src/routes/aiChat.ts` now passes `system` as a single-element content array with `cache_control: { type: "ephemeral" }`, marks the last assistant message in `priorMessages` with the same ephemeral marker on every turn so the 5-minute TTL keeps sliding, and accumulates `usage.cache_creation_input_tokens` + `usage.cache_read_input_tokens` from the `message_start` / `message_delta` stream events. The route also upserts a daily `(utc_day, model)` rollup row into the new `ai_chat_token_usage` table (`lib/db/src/schema/aiChatTokenUsage.ts`) summing input / output / cache-creation / cache-read tokens, request count, and warm-request count; the Site Health endpoint (`GET /api/cms/site-health`) reads that table and returns a per-day cache-hit-rate series plus an `alert` field that flips to `severity: "page"` when the most recent fully-elapsed UTC day's hit rate drops below 50 % over at least 5 requests (`severity: "insufficient-data"` below the request floor, `"ok"` otherwise). `applyToolCacheMarkers()` is exported and unit-tested for the future `searchEditorialCorpus` tool from #134, so the marker shape is pinned before the tool ships. `getSimpleCompletion()`-style helpers (e.g. the careers-AI scorer) remain non-cached — caching a small one-off block is net-negative. Test coverage: `pnpm --filter @workspace/api-server run test:prompt-cache` pins the wire shape (`cache_control: { type: "ephemeral" }`) and cold-vs-warm accumulator paths against the helpers, while `pnpm --filter @workspace/api-server run test:ai-chat-cache` drives the actual `/ai/chat` route end-to-end against a stubbed `anthropic.messages.stream` for cold-then-warm scenarios on the same conversation, asserting the captured `streamParams` shape and the resulting rollup row. **Remaining downstream UI work** (the admin dashboard widget that renders the daily series + dollar-savings figure on `/admin/site-config/health`) is tracked as a follow-up against #166's broader Site Health surface; the API + alert verdict are live.

### ~~#170 · Public-site search endpoint and `/search` page powered by Postgres FTS~~ — **Shipped May 2026**
**Depends on:** — (additive); referenced by #163 (the discovery-friendly 404 page assumes a `/api/search` endpoint exists), unblocks #134 phase 0 (cheaper full-text retrieval before the embedding layer ships)

**Shipped:** Generated `search_tsv` tsvector columns + GIN indexes added to all nine artifact tables (`posts`, `case_studies`, `white_papers`, `services`, `solutions`, `faq_items`, `polaris_episodes`, `applications`, `models`) via idempotent migrations in `artifacts/api-server/src/lib/migrations.ts`. `GET /api/search` runs `plainto_tsquery` UNION-ALL across the nine kinds, ranks via `ts_rank_cd * kindBoost`, returns `ts_headline` excerpts with inline `<mark>` highlighting, and cursor-paginates (limit ≤ 25). Per-kind boosts are editorially configurable through a new `searchKindBoosts` jsonb on `site_settings`. New `pages/search.tsx` provides the public results page (kind tabs, infinite scroll, `noindex`); the header gained a Cmd-K command-palette overlay using the existing `command.tsx` primitive that hits the same endpoint with live results; the 404 page's search input now points at the live endpoint. Telemetry lands in a new `search_queries` table surfaced through `/admin/insights/search-analytics` (totals, click-through rate, top zero-result queries, top queries, top clicked kinds — content-gap signal that pairs with #134's low-retrieval-confidence report).

The site has a real editorial corpus — Insights posts, case studies, white papers, services, solutions, FAQ, Polaris episodes, applications, models — but **no on-site search**. There is no `/api/search` route, no `/search` page, no search box in the header. Visitors who arrive via Google can only land on the post they searched for; once on the site they have to navigate by category or guess at slugs. The 404 page proposed in #163 explicitly assumes "a search input that hits `/api/search`" — so #163 can't fully ship until this lands. And the embedding-based corpus retrieval planned in #134 is months of work; a Postgres-FTS layer is hours of work and covers ~80 % of the same use-cases (find me posts about "data governance") without an embedding pipeline, an `editorial_embeddings` table, or a re-embedding cron.

This task ships a tsvector-backed search across every published artifact:
- **Schema.** Add a generated `search_tsv tsvector` column to each indexed artifact table (`posts`, `case_studies`, `white_papers`, `services`, `solutions`, `faq_items`, `polaris_episodes`, `applications`, `models`) computed as `setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') || setweight(to_tsvector('english', coalesce(body_text, '')), 'C')`. GIN index on each `search_tsv`. Recomputation is automatic via Postgres `GENERATED ALWAYS` so no app-side trigger or backfill cron is needed beyond a one-shot `REINDEX` after the column lands.
- **Endpoint.** `GET /api/search?q=&kind=&limit=&cursor=` runs `plainto_tsquery('english', :q)` against each enabled kind in parallel (UNION ALL with a kind discriminator), ranks via `ts_rank_cd(search_tsv, query) * kind_boost` where `kind_boost` is editorially configurable in `site_settings.searchKindBoosts` (default `{post:1.0, case_study:1.2, white_paper:1.1, service:1.5, solution:1.5}` so commercial pages outrank blog posts on equal-relevance ties), filters out `status != 'published'` and `deleted_at is not null`, returns `[{kind, id, slug, title, excerptHtml, rankScore}]` with `excerptHtml` produced by `ts_headline` for inline highlighting. Cursor pagination, `limit ≤ 25`.
- **Public page.** New `pages/search.tsx` with a query input (synced to the `?q=` URL param), per-kind tabs, infinite scroll, and a "no results — try X / talk to a human" CTA. SSR-friendly metadata (`<title>Search results for "{q}" — Synozur</title>`, `noindex` so the SERP isn't full of internal search URLs).
- **Header search.** A small search-icon button in the existing header that opens a command-palette-style overlay (Cmd-K) with live results from the same endpoint. Reuses the `command.tsx` shadcn primitive that's already in the bundle.
- **404 page wiring.** Drop the search input from #163 against this endpoint so a stale-link visitor sees "Did you mean…" hits before bouncing.
- **Telemetry.** Log `(query, resultCount, clickedKind, clickedRank)` into a new `search_queries` table; surface a "top 50 zero-result queries" report on the existing `/admin/insights/post-analytics`-style page so editorial sees content gaps. Pairs naturally with #134's "low retrieval confidence" report — both are surfacing the same signal at different layers.

Out of scope: typo tolerance (Postgres FTS has stemming but not fuzzy matching — defer to embeddings via #134), multi-language search (single-language `'english'` config; revisit when #139 lands a launch locale), private-content search inside Galaxy / partner portals (separate ACL surface).

---

## Strategic Roadmap

These entries describe future initiatives that do not yet have a project task system record. They are tracked here for planning purposes but are not counted in the active-task total above.

### Interactive maturity assessment replacing the static service-pillar pages
**Pairs with:** #131 (lead capture into HubSpot), case-study drafts pipeline (below)

The four service pillars today are essentially brochure pages — well-written but passive, and they convert via the same generic contact form as every other page. This initiative replaces (or augments — a/b test it) the pillar pages with an **interactive maturity assessment**. A visitor answers 10–14 questions across themes (AI readiness, delivery maturity, data foundation, change-management posture, technical debt) and gets:
- A scored maturity profile per dimension with a clear narrative.
- A personalized roadmap recommending specific Synozur services (mapped from the existing `services` table), solutions (mapped from `solutions`), and applications (Constellation, Vega, etc.) — with cited reasoning per recommendation.
- A downloadable PDF report (rendered server-side) the visitor can email to themselves and share internally.
- Optional contact-handoff to a real conversation, with the assessment results pre-populated into the contact-form payload and written through to HubSpot (#131) as contact properties + a `synozur_assessment_completed` timeline event.
Implementation: new tables `assessments` (`id`, `slug`, `version`, `published`), `assessment_questions` (`id`, `assessmentId`, `text`, `dimension`, `weights jsonb`, `sortOrder`), `assessment_responses` (anonymous + authenticated, with pii flag), `assessment_recommendations` (mapping from score profiles to services/solutions/applications). Admin UI under `/admin/marketing/assessments` lets non-engineers author new assessments, edit recommendations, and version them. Public surface at `/assessments/:slug` with a polished step-by-step UI. Out of scope: gamified scoring, multi-user team assessments (single-respondent only for v1), CRM-side scoring sync. Follow-up: surface the assessment as the primary CTA on the home page once we've validated conversion vs. the existing contact form.

### Astra AI concierge — site-wide chat assistant
**Depends on:** #134 (reuses both subsystems: the Vega-pattern grounding documents that build the system prompt, and the editorial-corpus retrieval tool); pairs with #131 (handoff to humans), maturity assessment above (deep-link into assessment)

Synozur's product family already follows a celestial naming convention (Vega, Orion, Nebula, Constellation, Orbit, Zenith) and "Polaris" is reserved for the podcast brand, so the concierge takes a distinct star-themed name: **Astra**. This initiative adds a persistent chat widget, branded as "Astra," that helps visitors navigate the site and answers questions on the spot. Scope:

- Floating chat button in the lower-right of every public page (and inside the Galaxy portal once #135 ships, with deeper context).
- **System prompt is built from the same `grounding_documents` table as Ask Synozur** so Ask Synozur and Astra can never disagree about Synozur methodology, brand voice, or terminology. Astra-specific guidance (greeting tone, escalation rules, when to offer a meeting) is added as new grounding documents in a `concierge_persona` category — *not* a parallel table — keeping the Vega "one grounding store, multiple consumers" property intact.
- Backed by Claude with three tool integrations: (a) the `searchEditorialCorpus` retrieval tool from #134 for content questions; (b) a `bookMeeting` tool that surfaces a Calendly-style scheduler; (c) a `submitContactForm` tool that fills the existing contact form on the visitor's behalf with their permission.
- Streaming responses with markdown + source-card rendering identical to the Ask Synozur page.
- An optional `concierge_eligible boolean default true` column on `grounding_documents` lets editors exclude an instructional doc from the concierge prompt without removing it from Ask Synozur (e.g. an internal-history doc that's fine on `/insights/ask` but shouldn't shape a sales chat). Default true keeps the shared-store invariant for normal cases.
- Strict guardrails: refuse pricing speculation, refuse to commit Synozur to delivery, hand off to a human via the contact form whenever the visitor explicitly asks for one or the model's confidence drops. Guardrails live as `best_practices` grounding documents so editors can tune them without code changes — same Vega pattern.
- Cookie-consent gated; conversation transcripts (with PII redaction) saved when the visitor consents and surfaced to admins under `/admin/marketing/astra` for review and content-gap mining — feeding the same low-retrieval-confidence report from #134 so editors see one unified view of where the corpus is thin.
- Rate-limited per IP and per session; abuse triggers a captcha and then a soft block.

Out of scope: voice mode, multi-language responses (#139 follow-up), agentic actions beyond the three tools above, a separate grounding-document table for the concierge (deliberately shared with #134; the `concierge_eligible` flag and the `concierge_persona` category are the only divergences). Follow-up: integrate the maturity assessment so Astra can steer relevant visitors into the assessment flow.

### Programmatic case-study drafts from Constellation engagement outcomes
**Depends on:** #128 (OAuth provider, so Constellation can talk back to this site as a registered client); pairs with consent workflow inside Constellation

Synozur runs more delivery work through Constellation (`scdp.synozur.com`) than the marketing team can write up — every engagement accumulates real artifacts (timeline adherence, risks burned down, hours saved, AI-synthesized executive narratives) that would make excellent case studies, but turning them into publishable copy today means a manual interview cycle weeks after the project closes. This initiative builds a **case-study drafting pipeline** that pulls anonymized Constellation outcomes into this site's CMS as `draft` rows for editor review. Scope: a new outbound API in Constellation publishes per-engagement summaries to `POST /api/cms/case-study-drafts` on this server (authenticated as a registered OAuth client per #128, with the `case_study.draft` scope); the endpoint validates the payload (project name, client display name, sector, summary metrics, key risks mitigated, timeline, anonymization flag), runs it through a draft-generation prompt against Claude (configurable model/version, prompt versioned in DB so we can A/B), and inserts a `draft` post into the existing `case_studies` table linked to the `collateral` artifact. Admin UI in `pages/admin/library/case-studies/` gains a "Generate from Constellation" button that lists eligible engagements (those with the client's marketing-consent flag set on the Constellation side), a side-by-side view of the raw outcome data and the generated draft, and an inline diff editor so the editor can refine before promoting to `scheduled` / `published`. A small audit trail records which Constellation engagement seeded which case study, the prompt + model version used, and the human edits applied — giving us both lineage and a feedback loop to improve the prompt. Out of scope: auto-publishing without human review (always-draft is a deliberate constraint), pulling testimonials directly from clients (separate consent workflow). Follow-up: extend to Polaris episode show-notes once the Polaris production pipeline matures.

---

## Summary Table

| # | Title | Area | Depends On |
|---|-------|------|-----------|
| ~~#56~~ | ~~Let editors manage services and solutions in the admin~~ — **Shipped** | Content Library | #40 |
| ~~#57~~ | ~~Verify the new services pages with automated browser tests~~ — **Shipped** | Admin Access & People | #40 |
| ~~#60~~ | ~~Preview services and solutions before publishing~~ — **Shipped May 2026** | Content Library | #39, #56 |
| ~~#61~~ | ~~Track edit history for services and solutions~~ — **Shipped May 2026** | Content Library | #39, #56 |
| ~~#66~~ | ~~Preview a revision's content before restoring it~~ — **Shipped May 2026** | Content Library | #48 |
| ~~#67~~ | ~~Show a diff between the current version and a past revision~~ — **Shipped May 2026** | Content Library | #48 |
| ~~#68~~ | ~~Auto-trim old post revisions~~ — **Shipped May 2026** | Content Library | #48 |
| ~~#75~~ | ~~Bulk reorder featured library items via drag-and-drop~~ — **Shipped May 2026** | Content Library | #69 |
| ~~#76~~ | ~~Show a live preview of how a library item will appear on the public site~~ — **Shipped May 2026** | Content Library | #69 |
| ~~#83~~ | ~~Gated download CTA for white papers~~ — **Dropped May 2026 (handled by HubSpot)** | Marketing & Lifecycle | — |
| ~~#84~~ | ~~Seed & verify 301 redirects from Wix~~ — **Shipped (seeder)** | Public Site UX | — |
| ~~#85~~ | ~~Upcoming webinar registration rail~~ — **Dropped May 2026 (handled by Teams webinar)** | Marketing & Lifecycle | — |
| #86 | Fix OG tags for social link previews — **infrastructure shipped, prod data backfill open (L7)** | Marketing & Lifecycle | — |
| ~~#102~~ | ~~Connect search engine submission to live credentials~~ — **Shipped May 2026** | Marketing & Lifecycle | #97 |
| ~~#109~~ | ~~Careers / HR module under /admin/people/careers~~ — **Shipped May 2026** | Admin Access & People | — |
| ~~#110~~ | ~~Show a video thumbnail preview when a custom hero video is active~~ — **Shipped May 2026** | Admin Access & People | #106 |
| ~~#111~~ | ~~Validate video uploads before they reach object storage~~ — **Shipped May 2026** | Admin Access & People | #106 |
| ~~#119~~ | ~~Add automated browser tests for the full sign-in and sign-out flow~~ — **Shipped May 2026** | Admin Access & People | #115 |
| ~~#128~~ | ~~OAuth 2.0 / OIDC provider for other Synozur web apps~~ — **Shipped May 2026** | Admin Access & People | #110 |
| #129 | Cross-app switcher (Constellation, Vega, …) for signed-in users | Admin Access & People | #128 |
| #130 | Admin-controlled UX theme switcher (Baseline / Aurora / …) | Admin Access & People | #128, #110 |
| #132 | SendGrid integration for marketing email and deliverability redundancy | Marketing & Lifecycle | — |
| ~~#133~~ | ~~Constellation interactive demo sandbox on /applications/constellation~~ — **Shipped May 2026** | Public Site UX | — |
| ~~#134~~ | ~~"Ask Synozur" — Vega-pattern grounding documents + retrieval over the editorial corpus~~ — **Shipped May 2026 (#262)** | Public Site UX | — |
| ~~#135~~ | ~~Galaxy client portal — v0~~ — **Shipped May 2026 (#224 + #225 + #226 + #227)** | Admin Access & People | #110, #111, #128 |
| ~~#224~~ | ~~Galaxy client portal — v0 foundation~~ — **Shipped May 2026** | Admin Access & People | #135 |
| ~~#225~~ | ~~Galaxy — client-organization admin in the main site~~ — **Shipped May 2026** | Admin Access & People | #135 |
| ~~#226~~ | ~~Galaxy — per-application cockpit surfaces~~ — **Shipped May 2026** | Admin Access & People | #135, #225 |
| ~~#227~~ | ~~Galaxy — deliverables document browser over SPE~~ — **Shipped May 2026** | Admin Access & People | #135, #127 |
| ~~#228~~ | ~~Centralized multi-property traffic reporting~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| ~~#136~~ | ~~Verify remember-me sessions get the longer 30-day window when renewed~~ — **Shipped May 2026** | Admin Access & People | #133 |
| ~~#137~~ | ~~Cover the session garbage-collector and revocation helpers with tests~~ — **Shipped May 2026** | Admin Access & People | #133 |
| ~~#138~~ | ~~Stop pillar overview pages from competing with service pages on Google~~ — **Shipped (canonical)** | Public Site UX | #55 |
| #139 | Internationalization foundation (English + one launch locale) | Public Site UX | — |
| #140 | Experimentation framework + conversion-funnel analytics | Marketing & Lifecycle | — |
| #141 | Partner & co-marketing portal | Admin Access & People | #110, #111, #128 |
| ~~#144~~ | ~~Add automated tests to confirm sign-up rate limiting works~~ — **Shipped May 2026** | Admin Access & People | #141 |
| ~~#151~~ | ~~Show spam comment count badge on the moderation navigation item~~ — **Shipped May 2026** | Content Library | #54 |
| ~~#152~~ | ~~Add Akismet integration to catch more spam automatically~~ — **Shipped May 2026** | Content Library | #54 |
| ~~#153~~ | ~~Make the spam rules settings page accessible to end-to-end automated testing~~ — **Shipped May 2026** | Content Library | #54 |
| ~~#154~~ | ~~Ship a Web App Manifest (PWA) for the public site~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| ~~#155~~ | ~~Add security headers via `helmet` in the API server~~ — **Shipped (PR #68)** | Marketing & Lifecycle | — |
| ~~#156~~ | ~~Make Lighthouse CI block PRs instead of running on manual trigger~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| ~~#157~~ | ~~CI broken-link checker over the published site~~ — **Shipped May 2026** | Marketing & Lifecycle | #156 |
| ~~#158~~ | ~~Add `eslint-plugin-jsx-a11y` and a pre-commit a11y/SEO gate~~ — **Shipped (#235)** | Marketing & Lifecycle | — |
| ~~#159~~ | ~~Expand JSON-LD schema coverage (LocalBusiness, Person, Review, VideoObject)~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| ~~#160~~ | ~~Search Console domain-property verification + indexing dashboard~~ — **Shipped May 2026** (code; DNS verification = L2 ops) | Marketing & Lifecycle | #102 |
| ~~#161~~ | ~~Dynamic OG image generation for insights, case studies, and Polaris episodes~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| ~~#162~~ | ~~Use 410 Gone and 308 Permanent Redirect for unpublished and moved content~~ — **Shipped May 2026** | Public Site UX | — |
| ~~#163~~ | ~~Tune robots meta directives and add a discovery-friendly 404 page~~ — **Shipped May 2026** | Public Site UX | — |
| ~~#164~~ | ~~Extend the event-detail share rail to insights, case studies, and white papers~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| ~~#165~~ | ~~Honor `prefers-color-scheme` for first-time visitors~~ — **Shipped May 2026** | Public Site UX | — |
| ~~#166~~ | ~~Lock down `/ai/chat` — auth, rate limits, conversation ACL, per-identity token budget~~ — **Shipped May 2026** | Public Site UX | — |
| ~~#167~~ | ~~Apply Anthropic prompt caching across the AI chat + grounding pipeline~~ — **Shipped May 2026** | Public Site UX | #166 |
| ~~#131~~ | ~~HubSpot lead capture and lifecycle sync — provider abstraction, queued contact upserts + timeline events, custom Synozur properties, subscription mirroring (HubSpot ↔ local), admin health page, backlog migration, hutk identity stitching~~ — **Shipped May 2026 (#263)** | Marketing & Lifecycle | — |
| ~~#168~~ | ~~Double opt-in confirmation for newsletter subscribers~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| ~~#169~~ | ~~Admin audit-log viewer with entity-scoped activity tab and 365-day retention~~ — **Shipped May 2026** | Admin Access & People | — |
| ~~#170~~ | ~~Public-site search endpoint and `/search` page powered by Postgres FTS~~ — Shipped May 2026 | Public Site UX | — |
| ~~#185~~ | ~~Add Playwright coverage for the Polaris collateral sync flow~~ — **Shipped May 2026** | Content Library | #69 |
| ~~#190~~ | ~~Extend Zenith solution-enrichment seed to Company OS and Employee Strategies~~ — **Shipped May 2026** | Content Library | #56 |
| ~~#207~~ | ~~Show per-episode library sync status in the Polaris episode list~~ — **Shipped May 2026** | Content Library | #69 |
| ~~#209~~ | ~~Apply the confirmation step to other destructive admin actions~~ — **Shipped May 2026** | Content Library | — |
| ~~#215~~ | ~~Make the Alt Home (`/home-b`) hero, pillars, and closing CTA copy admin-editable~~ — **Shipped May 2026** | Public Site UX | — |
| ~~#216~~ | ~~Admin-controlled homepage variant at `/`~~ — **Shipped May 2026** | Public Site UX | #215 |
| ~~#220~~ | ~~Send branded transactional email through SendGrid~~ — **Shipped May 2026** | Marketing & Lifecycle | — |
| — | Interactive maturity assessment replacing the static service-pillar pages | Strategic Roadmap | #131 |
| — | Astra AI concierge — site-wide chat assistant | Strategic Roadmap | #134 |
| — | Programmatic case-study drafts from Constellation engagement outcomes | Strategic Roadmap | #128 |
