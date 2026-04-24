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
