// Task #366 — Repair stored image content-types on GCS-backed media objects.
//
// Some historical uploads landed in the bucket with a generic
// `application/octet-stream` (or empty) content-type even though the bytes
// are a perfectly good raster image. Task #361 added a runtime byte-sniff so
// the on-the-fly resize (`?w=...&fmt=...`, used for OG share cards) still
// works despite the bad metadata — but every NON-resize path is still broken:
// direct downloads save as unnamed binary blobs, browsers won't inline them,
// and CDN/caching behaves oddly because the served content-type comes from the
// object's own stored metadata (see `downloadObject` in gcsBackend.ts), NOT
// from `media.mime`.
//
// This one-shot, idempotent script scans GCS-backed media rows, and for any
// whose STORED object content-type is ambiguous, sniffs the leading bytes and:
//   • rewrites the GCS object's content-type metadata to the real image/* type
//   • updates `media.mime` to match when it is null/ambiguous too
//
// What it never does:
//   • touch the object bytes (only the content-type metadata resource)
//   • touch rows that already have a concrete image/* content-type (re-running
//     is safe — those are skipped)
//   • touch SPE-backed rows (spe_file_id set) — SPE derives content-type from
//     the file at download time and has no equivalent metadata patch; the
//     octet-stream problem is a GCS-upload artifact.
//   • change ambiguous objects whose bytes are NOT a raster image (e.g. PDFs) —
//     those are logged and left unchanged since this task is scoped to images.
//
// Standing action note: this repairs PRODUCTION stored metadata, so it must be
// run once against the production bucket/DB after merge:
//
//   DATABASE_URL="<prod-url>" NODE_ENV=production \
//     PUBLIC_OBJECT_SEARCH_PATHS="..." PRIVATE_OBJECT_DIR="..." \
//     pnpm --filter @workspace/api-server backfill:image-content-types
//
// Usage:
//   pnpm --filter @workspace/api-server backfill:image-content-types [--dry-run] [--limit N] [--concurrency N]
//
//   --dry-run        report what would change; write nothing
//   --limit N        stop after inspecting N candidate rows
//   --concurrency N  parallel object inspections (default 8)

import { eq, isNull, sql } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import { GcsAssetStorageBackend } from "../lib/storage/gcsBackend";
import { ObjectNotFoundError } from "../lib/storage/types";
import { isAmbiguousContentType, sniffRasterImageMime } from "../routes/storage";

// 16 leading bytes is enough for every signature `sniffRasterImageMime` checks.
const IMAGE_SNIFF_BYTES = 16;

interface Args {
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, limit: null, concurrency: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--limit needs a positive integer");
      out.limit = n;
    } else if (a === "--concurrency") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--concurrency needs a positive integer");
      out.concurrency = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: backfill:image-content-types [--dry-run] [--limit N] [--concurrency N]",
          "",
          "  --dry-run        report what would change; write nothing",
          "  --limit N        stop after inspecting N candidate rows",
          "  --concurrency N  parallel object inspections (default 8)",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

interface Stats {
  inspected: number;
  corrected: number;
  alreadyOk: number;
  notRaster: number;
  missing: number;
  errors: number;
}

type RowOutcome =
  | { kind: "corrected"; id: string; from: string; to: string }
  | { kind: "already-ok" }
  | { kind: "not-raster"; id: string; storedType: string }
  | { kind: "missing"; id: string }
  | { kind: "error"; id: string; reason: string };

async function processRow(
  gcs: GcsAssetStorageBackend,
  row: { id: string; storageKey: string; mime: string | null },
  dryRun: boolean,
): Promise<RowOutcome> {
  let ref;
  try {
    ref = await gcs.getObjectEntityFile(row.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return { kind: "missing", id: row.id };
    }
    return { kind: "error", id: row.id, reason: (err as Error).message };
  }

  let storedType: string;
  try {
    storedType = (await gcs.getObjectContentType(ref)) ?? "";
  } catch (err) {
    return { kind: "error", id: row.id, reason: (err as Error).message };
  }

  // Idempotency: only ambiguous stored types are candidates. A row that was
  // already corrected (or was always correct) serves a concrete image/* type
  // and is left untouched, so re-running the script is a no-op for it.
  if (!isAmbiguousContentType(storedType)) {
    return { kind: "already-ok" };
  }

  let header: Buffer;
  try {
    header = await gcs.peekObjectHeader(ref, IMAGE_SNIFF_BYTES);
  } catch (err) {
    return { kind: "error", id: row.id, reason: (err as Error).message };
  }

  const sniffed = sniffRasterImageMime(header);
  if (!sniffed) {
    // Ambiguous but not a raster image (e.g. a PDF stored as octet-stream).
    // Out of scope for this task — leave the metadata as-is.
    return { kind: "not-raster", id: row.id, storedType: storedType || "(empty)" };
  }

  if (!dryRun) {
    await gcs.setObjectContentType(ref, sniffed);
    // Keep the DB row consistent when its mime is also missing/ambiguous.
    // Never overwrite a concrete mime an editor may have curated.
    if (!row.mime || isAmbiguousContentType(row.mime)) {
      await db
        .update(mediaTable)
        .set({ mime: sniffed })
        .where(eq(mediaTable.id, row.id));
    }
  }

  return {
    kind: "corrected",
    id: row.id,
    from: storedType || "(empty)",
    to: sniffed,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gcs = new GcsAssetStorageBackend();

  // Only GCS-backed rows. SPE rows (spe_file_id set) derive their
  // content-type from the file itself and have no metadata patch path.
  const rows = await db
    .select({
      id: mediaTable.id,
      storageKey: mediaTable.storageKey,
      mime: mediaTable.mime,
    })
    .from(mediaTable)
    .where(isNull(mediaTable.speFileId));

  const [{ c: totalMedia }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(mediaTable);

  const candidates = args.limit != null ? rows.slice(0, args.limit) : rows;

  console.log(
    `media: ${totalMedia} total · ${rows.length} GCS-backed · inspecting ${candidates.length}` +
      (args.dryRun ? " (DRY RUN — nothing written)" : "") +
      ` · concurrency=${args.concurrency}`,
  );

  const stats: Stats = {
    inspected: 0,
    corrected: 0,
    alreadyOk: 0,
    notRaster: 0,
    missing: 0,
    errors: 0,
  };

  // Simple fixed-size worker pool over the candidate list.
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= candidates.length) return;
      const row = candidates[idx]!;
      const outcome = await processRow(gcs, row, args.dryRun);
      stats.inspected++;
      switch (outcome.kind) {
        case "corrected":
          stats.corrected++;
          console.log(
            `  ${args.dryRun ? "would fix" : "fixed"} ${outcome.id}: ${outcome.from} → ${outcome.to}`,
          );
          break;
        case "already-ok":
          stats.alreadyOk++;
          break;
        case "not-raster":
          stats.notRaster++;
          console.warn(
            `  ambiguous but not a raster image, left unchanged ${outcome.id} (stored: ${outcome.storedType})`,
          );
          break;
        case "missing":
          stats.missing++;
          console.warn(`  object missing in bucket, skipped ${outcome.id}`);
          break;
        case "error":
          stats.errors++;
          console.error(`  error ${outcome.id}: ${outcome.reason}`);
          break;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, candidates.length) }, () => worker()),
  );

  console.log(
    JSON.stringify(
      { ok: stats.errors === 0, dryRun: args.dryRun, ...stats },
      null,
      2,
    ),
  );

  if (stats.errors > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
