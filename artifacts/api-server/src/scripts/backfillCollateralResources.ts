/**
 * #122 — Backfill: lift each collateral row's existing `download_url` into a
 * `collateral_resources` row so the new Resources editor and public detail
 * Resources section have something to render. Run once after the schema
 * push that adds `collateral_resources`:
 *
 *   pnpm --filter @workspace/api-server exec \
 *     tsx src/scripts/backfillCollateralResources.ts
 *
 * Idempotent: a collateral row is skipped when it already has at least one
 * resource attached. The legacy `collateral.download_url` column is left
 * intact — the route handlers keep it in sync as a read-only mirror of the
 * first-by-sortOrder resource until the column is dropped in a follow-up.
 *
 * URL classification:
 *   - URLs that start with `/api/storage/` are treated as object-storage
 *     references and matched against `media.storage_key`. When a media row
 *     exists, the resource is created media-backed (mediaId set, externalUrl
 *     null) so the new MediaPicker UI can recognize and replace it.
 *   - All other URLs (off-platform: GitHub, Figma, vendor CDNs, etc.) are
 *     treated as external links (externalUrl set, mediaId null).
 *
 * Label heuristic: type-aware default — "Slides" for podcast/training,
 * "White paper" for white_paper/ebook, "Recording" for webinar/video,
 * else "Download". Editors can rename in the admin Resources editor.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  collateralTable,
  collateralResourcesTable,
  mediaTable,
} from "@workspace/db";

const STORAGE_URL_PREFIX = "/api/storage";

function deriveStorageKey(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withoutQuery = trimmed.split("?")[0];
  const idx = withoutQuery.indexOf(STORAGE_URL_PREFIX);
  if (idx < 0) return null;
  return withoutQuery.slice(idx + STORAGE_URL_PREFIX.length) || null;
}

function defaultLabelFor(type: string): string {
  switch (type) {
    case "white_paper":
    case "ebook":
      return "White paper";
    case "webinar":
    case "video":
      return "Recording";
    case "podcast":
    case "training":
      return "Slides";
    case "case_study":
      return "Case study";
    case "model":
      return "Model";
    default:
      return "Download";
  }
}

async function main() {
  const candidates = await db
    .select({
      id: collateralTable.id,
      type: collateralTable.type,
      slug: collateralTable.slug,
      downloadUrl: collateralTable.downloadUrl,
    })
    .from(collateralTable)
    .where(
      and(
        isNotNull(collateralTable.downloadUrl),
        sql`length(trim(${collateralTable.downloadUrl})) > 0`,
      ),
    );

  let inserted = 0;
  let skippedExisting = 0;
  let skippedEmpty = 0;
  let resolvedToMedia = 0;
  let resolvedToExternal = 0;

  for (const c of candidates) {
    const url = c.downloadUrl?.trim();
    if (!url) {
      skippedEmpty++;
      continue;
    }

    // Skip rows that already have any resource attached — running the script
    // twice should be a no-op.
    const already = await db
      .select({ id: collateralResourcesTable.id })
      .from(collateralResourcesTable)
      .where(eq(collateralResourcesTable.collateralId, c.id))
      .limit(1);
    if (already.length > 0) {
      skippedExisting++;
      continue;
    }

    let mediaId: string | null = null;
    const storageKey = deriveStorageKey(url);
    if (storageKey) {
      const m = await db.query.mediaTable.findFirst({
        where: eq(mediaTable.storageKey, storageKey),
      });
      if (m) mediaId = m.id;
    }

    await db.insert(collateralResourcesTable).values({
      collateralId: c.id,
      mediaId,
      // When we couldn't resolve a storage key to a media row (e.g. legacy
      // URL with a different prefix, or a deleted media row), keep the URL
      // as-is on `externalUrl` so the resource still renders.
      externalUrl: mediaId ? null : url,
      label: defaultLabelFor(c.type),
      mimeType: null,
      sortOrder: 10,
    });

    if (mediaId) resolvedToMedia++;
    else resolvedToExternal++;
    inserted++;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Backfill complete. inserted=${inserted} (media-backed=${resolvedToMedia}, external=${resolvedToExternal}); skipped=${skippedExisting} already-has-resources, ${skippedEmpty} empty download_url; total candidates=${candidates.length}.`,
  );

  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
