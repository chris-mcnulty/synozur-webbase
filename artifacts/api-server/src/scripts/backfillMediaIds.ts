/**
 * BACKLOG.md §1 item 1 — Backfill the new `*_media_id` UUID columns from the
 * legacy `*_asset_id` integer columns by joining `assets.storage_key` against
 * `media.storage_key`. Run after `pnpm --filter @workspace/db run push` to
 * populate the parallel pointers so the new MediaPickerModal-aware editors
 * see the same picture as the legacy AssetLibraryModal.
 *
 * Idempotent: only writes when the *MediaId column is NULL on a row whose
 * *AssetId column is set and a media row with the same storage_key exists.
 */
import { eq, isNull, and, isNotNull, inArray, sql } from "drizzle-orm";
import {
  db,
  assetsTable,
  eventsTable,
  mediaTable,
  siteSettingsTable,
  whitePapersTable,
} from "@workspace/db";

async function buildAssetToMediaMap(
  assetIds: number[],
): Promise<Map<number, string>> {
  if (assetIds.length === 0) return new Map();
  const assets = await db
    .select({ id: assetsTable.id, storageKey: assetsTable.storageKey })
    .from(assetsTable)
    .where(inArray(assetsTable.id, assetIds));
  const storageKeys = assets.map((a) => a.storageKey);
  if (storageKeys.length === 0) return new Map();
  const mediaRows = await db
    .select({ id: mediaTable.id, storageKey: mediaTable.storageKey })
    .from(mediaTable)
    .where(inArray(mediaTable.storageKey, storageKeys));
  const mediaByKey = new Map(mediaRows.map((m) => [m.storageKey, m.id]));
  const out = new Map<number, string>();
  for (const a of assets) {
    const mediaId = mediaByKey.get(a.storageKey);
    if (mediaId) out.set(a.id, mediaId);
  }
  return out;
}

async function backfillEventsImage(): Promise<{ updated: number; skipped: number }> {
  const rows = await db
    .select({ id: eventsTable.id, assetId: eventsTable.imageAssetId })
    .from(eventsTable)
    .where(
      and(isNotNull(eventsTable.imageAssetId), isNull(eventsTable.imageMediaId)),
    );
  const assetIds = rows
    .map((r) => r.assetId)
    .filter((v): v is number => v != null);
  const map = await buildAssetToMediaMap(assetIds);
  let updated = 0;
  for (const r of rows) {
    if (r.assetId == null) continue;
    const mediaId = map.get(r.assetId);
    if (!mediaId) continue;
    await db
      .update(eventsTable)
      .set({ imageMediaId: mediaId })
      .where(eq(eventsTable.id, r.id));
    updated++;
  }
  return { updated, skipped: rows.length - updated };
}

async function backfillWhitePapersDocument(): Promise<{
  updated: number;
  skipped: number;
}> {
  const rows = await db
    .select({
      id: whitePapersTable.id,
      assetId: whitePapersTable.documentAssetId,
    })
    .from(whitePapersTable)
    .where(
      and(
        isNotNull(whitePapersTable.documentAssetId),
        isNull(whitePapersTable.documentMediaId),
      ),
    );
  const assetIds = rows
    .map((r) => r.assetId)
    .filter((v): v is number => v != null);
  const map = await buildAssetToMediaMap(assetIds);
  let updated = 0;
  for (const r of rows) {
    if (r.assetId == null) continue;
    const mediaId = map.get(r.assetId);
    if (!mediaId) continue;
    await db
      .update(whitePapersTable)
      .set({ documentMediaId: mediaId })
      .where(eq(whitePapersTable.id, r.id));
    updated++;
  }
  return { updated, skipped: rows.length - updated };
}

// `site_settings` is intentionally a single-row table keyed at id=1 (see
// `loadOrCreateSettings()` in routes/siteSettings.ts). Scope the lookup so
// the script never touches a stray test/seed row.
const SITE_SETTINGS_ROW_ID = 1;

async function backfillSiteSettingsMedia(): Promise<{
  updated: number;
  skipped: number;
}> {
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, SITE_SETTINGS_ROW_ID));
  if (!row) return { updated: 0, skipped: 0 };
  const assetIds = [
    row.homeHeroImageAssetId,
    row.homeHeroVideoAssetId,
    row.homeEditorialImageAssetId,
    row.seoDefaultOgImageAssetId,
    row.orgLogoAssetId,
  ].filter((v): v is number => v != null);
  if (assetIds.length === 0) return { updated: 0, skipped: 0 };
  const map = await buildAssetToMediaMap(assetIds);

  const updates: Partial<typeof siteSettingsTable.$inferInsert> = {};
  let touched = 0;

  if (
    row.homeHeroImageAssetId != null &&
    row.homeHeroImageMediaId == null
  ) {
    const m = map.get(row.homeHeroImageAssetId);
    if (m) {
      updates.homeHeroImageMediaId = m;
      touched++;
    }
  }
  if (
    row.homeHeroVideoAssetId != null &&
    row.homeHeroVideoMediaId == null
  ) {
    const m = map.get(row.homeHeroVideoAssetId);
    if (m) {
      updates.homeHeroVideoMediaId = m;
      touched++;
    }
  }
  if (
    row.homeEditorialImageAssetId != null &&
    row.homeEditorialImageMediaId == null
  ) {
    const m = map.get(row.homeEditorialImageAssetId);
    if (m) {
      updates.homeEditorialImageMediaId = m;
      touched++;
    }
  }
  if (
    row.seoDefaultOgImageAssetId != null &&
    row.seoDefaultOgImageMediaId == null
  ) {
    const m = map.get(row.seoDefaultOgImageAssetId);
    if (m) {
      updates.seoDefaultOgImageMediaId = m;
      touched++;
    }
  }
  if (row.orgLogoAssetId != null && row.orgLogoMediaId == null) {
    const m = map.get(row.orgLogoAssetId);
    if (m) {
      updates.orgLogoMediaId = m;
      touched++;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(siteSettingsTable)
      .set(updates)
      .where(eq(siteSettingsTable.id, SITE_SETTINGS_ROW_ID));
  }
  return { updated: touched, skipped: assetIds.length - touched };
}

async function main() {
  const [events, whitePapers, siteSettings] = await Promise.all([
    backfillEventsImage(),
    backfillWhitePapersDocument(),
    backfillSiteSettingsMedia(),
  ]);
  const [{ c: assetCount }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(assetsTable);
  const [{ c: mediaCount }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(mediaTable);
  console.log(
    JSON.stringify(
      {
        ok: true,
        events,
        whitePapers,
        siteSettings,
        totals: { assets: assetCount, media: mediaCount },
      },
      null,
      2,
    ),
  );
}

void (async () => {
  try {
    await main();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
