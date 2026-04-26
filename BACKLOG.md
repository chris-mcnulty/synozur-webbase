# Backlog / Technical Debt

## Asset Library consolidation (follow-up to asset-library admin UI)

Context: the April 2026 "Asset Library admin" work introduced the editable
`asset_categories` table and a unified admin page at `/admin/library/assets`,
but intentionally deferred the full physical merge of the legacy `assets`
table into `media` to keep the diff reviewable and protect the 15 admin
editors that still reference the legacy asset picker.

Follow-up items, in recommended order:

1. **Migrate 15 admin editors from `AssetLibraryModal` (integer asset IDs) to a
   unified `MediaPickerModal` that reads from `/cms/media` (UUID media IDs).**
   Current callers:
   - `pages/admin/site-config/site-settings.tsx`
   - `pages/admin/marketing/seo.tsx`
   - `pages/admin/library/collateral-edit.tsx`
   - `pages/admin/library/video-edit.tsx`
   - `pages/admin/library/white-paper-edit.tsx`
   - `pages/admin/library/workshop-edit.tsx`
   - `pages/admin/people/event-form.tsx`
   Each caller persists an `*AssetId` integer FK. Migrating requires adding a
   new `*MediaId` UUID column alongside, backfilling via `assets.storage_key`
   lookup against `media.storage_key`, and updating serializers/public read
   APIs in lockstep.

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

1. **Apply the schema migration in every environment.** `pnpm --filter
   @workspace/db run push` will drop `clerk_user_id` and add
   `external_subject`, `auth_provider`, `last_sign_in_at`, plus the new
   `sessions` and `auth_pending_states` tables. Run dev → staging →
   production; verify the OIDC sign-in round-trip after each.

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

5. **Backfill `external_subject` / `auth_provider` for imported-author
   rows.** `scripts/fixPostAuthors.ts` writes
   `auth_provider="imported"`, `external_subject="imported:<local-part>"`.
   The OIDC callback path will rewrite these on first Entra sign-in, but
   any author who never signs in stays as a placeholder forever. Add a
   one-shot `scripts/linkImportedAuthors.ts` that resolves placeholder
   rows by email against Microsoft Graph (`/users?$filter=mail eq '…'`)
   and rewrites `external_subject` / `entra_object_id` in bulk.

6. **Remove the `/sign-up` redirect stub** (`pages/sign-up.tsx`) once
   GA4 / 404 logs confirm zero inbound traffic for ≥30 days. The route
   exists today only to keep old `/sign-up` bookmarks from 404ing.

7. **Add a `provider` filter to the `/admin/access/users` table** so an
   admin can see at a glance which users have signed in via Entra vs. are
   still placeholder (`imported` / `dev`) rows. Trivial UI change once
   #5 stops being necessary.

8. **Delete the `last_sso_provider` column from `users`** once #5 ships
   and `auth_provider` is the canonical signal — `last_sso_provider`
   was added during the OIDC migration as a transitional field and is
   now redundant.

9. **Add a Playwright sign-in smoke test** that exercises `/sign-in →
   Entra → /callback → /api/auth/me`. Pairs naturally with #57 (Playwright
   end-to-end harness) — needs an Entra test tenant and a service-account
   credential that can survive automated sign-in challenges.

10. **Strip the `dev-login` escape hatch** (`/api/auth/dev-login`,
    gated on `ALLOW_DEV_LOGIN=1` + localhost) once the team has switched
    fully to Entra-backed local dev. The route is inert in production
    and on non-localhost requests, but removing it closes one more
    surface.

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
