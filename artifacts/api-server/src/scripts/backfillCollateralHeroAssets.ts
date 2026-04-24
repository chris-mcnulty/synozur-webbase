/**
 * #119 — Backfill collateral hero images (and the sibling library artifacts
 * that feed collateral: videos, white papers, workshops) into the unified
 * `assets` table so the new AssetLibraryModal picker can find them.
 *
 * Today these editors pick a hero from `cms_media` and we store the rendered
 * URL (e.g. `/api/storage/objects/uploads/<id>`) into the item's `hero_image`
 * text column. The new picker reads from the `assets` table instead. This
 * script walks every hero_image URL, derives the storage key, and — if no
 * asset already points at that storage key — inserts an `assets` row with
 * category `abstract` so editors can browse / reclassify from the picker.
 *
 * Idempotent: re-running skips hero URLs already represented in `assets`.
 */
import { inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  assetsTable,
  collateralTable,
  mediaTable,
  videosTable,
  whitePapersTable,
  workshopsTable,
} from "@workspace/db";

const STORAGE_URL_PREFIX = "/api/storage";

function deriveStorageKey(heroUrl: string): string | null {
  const trimmed = heroUrl.trim();
  if (!trimmed) return null;
  // Strip a querystring (e.g. ?w=128) — we care about the object, not the variant.
  const withoutQuery = trimmed.split("?")[0];
  const idx = withoutQuery.indexOf(STORAGE_URL_PREFIX);
  if (idx < 0) return null; // External URL — nothing to backfill.
  return withoutQuery.slice(idx + STORAGE_URL_PREFIX.length) || null;
}

function filenameFrom(storageKey: string): string {
  const last = storageKey.split("/").pop() ?? storageKey;
  return last || "hero";
}

interface HeroSource {
  label: string;
  load: () => Promise<Array<{ heroImage: string | null | undefined }>>;
}

const SOURCES: HeroSource[] = [
  {
    label: "collateral",
    load: () =>
      db
        .select({ heroImage: collateralTable.heroImage })
        .from(collateralTable)
        .where(isNotNull(collateralTable.heroImage)),
  },
  {
    label: "videos",
    load: () =>
      db
        .select({ heroImage: videosTable.heroImage })
        .from(videosTable)
        .where(isNotNull(videosTable.heroImage)),
  },
  {
    label: "whitePapers",
    load: () =>
      db
        .select({ heroImage: whitePapersTable.heroImage })
        .from(whitePapersTable)
        .where(isNotNull(whitePapersTable.heroImage)),
  },
  {
    label: "workshops",
    load: () =>
      db
        .select({ heroImage: workshopsTable.heroImage })
        .from(workshopsTable)
        .where(isNotNull(workshopsTable.heroImage)),
  },
];

async function main() {
  const storageKeys = new Set<string>();
  for (const src of SOURCES) {
    let rows: Array<{ heroImage: string | null | undefined }> = [];
    try {
      rows = await src.load();
    } catch (err) {
      console.warn(`[${src.label}] skipped (table missing?)`, err);
      continue;
    }
    let found = 0;
    for (const r of rows) {
      const key = deriveStorageKey(r.heroImage ?? "");
      if (key) {
        storageKeys.add(key);
        found++;
      }
    }
    console.log(`[${src.label}] ${rows.length} rows, ${found} storage-backed heroes`);
  }

  if (storageKeys.size === 0) {
    console.log("No storage-backed hero images found — nothing to backfill.");
    return;
  }

  const keyArray = Array.from(storageKeys);

  // Batch-fetch all storageKeys already present in the assets table.
  const existingRows = await db
    .select({ storageKey: assetsTable.storageKey })
    .from(assetsTable)
    .where(inArray(assetsTable.storageKey, keyArray));
  const alreadyIndexedKeys = new Set(existingRows.map((r) => r.storageKey));

  const missingKeys = keyArray.filter((k) => !alreadyIndexedKeys.has(k));
  const alreadyIndexed = keyArray.length - missingKeys.length;

  let inserted = 0;

  if (missingKeys.length > 0) {
    // Batch-fetch all matching cms_media rows in one query.
    const mediaRows = await db
      .select()
      .from(mediaTable)
      .where(inArray(mediaTable.storageKey, missingKeys));
    const mediaByKey = new Map(mediaRows.map((m) => [m.storageKey, m]));

    const newAssets = missingKeys.map((storageKey) => {
      const m = mediaByKey.get(storageKey);
      const filename = filenameFrom(storageKey);
      return {
        filename,
        originalName: m?.altText ?? filename,
        mimeType: m?.mime ?? "image/jpeg",
        size: m?.byteSize ?? 0,
        storageKey,
        uploadedBy: m?.uploadedBy ?? null,
        category: "abstract" as const,
      };
    });

    await db.insert(assetsTable).values(newAssets);
    inserted = newAssets.length;
  }

  const [total] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(assetsTable);
  console.log(
    `Backfill complete. inserted=${inserted}, already-indexed=${alreadyIndexed}, ` +
      `distinct storage keys=${storageKeys.size}, assets table size=${total?.c ?? 0}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
