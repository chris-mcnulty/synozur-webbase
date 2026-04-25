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
