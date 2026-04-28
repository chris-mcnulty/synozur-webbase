// #127 Phase 3-B — GCS → SharePoint Embedded migration.
//
// One-shot, resumable, additive-only. For each `media` row with
// spe_file_id IS NULL we:
//   1. Stream the bytes from GCS (via the existing GcsAssetStorageBackend).
//   2. Upload them to the active SPE container.
//   3. UPDATE media SET spe_file_id = …, spe_container_id = … WHERE id = …
//
// What this script DOES NOT DO, by design, ever:
//   • delete from GCS
//   • rewrite media.storage_key
//   • touch any row that already has spe_file_id (it's already migrated;
//     re-running is safe and just skips it)
//
// The GCS bucket is the rollback safety net. Bytes stay there until
// decommissioned manually after the post-cutover soak.
//
// Usage:
//   pnpm --filter @workspace/api-server migrate:gcs-to-spe -- --dry-run
//   pnpm --filter @workspace/api-server migrate:gcs-to-spe -- --limit 10
//   pnpm --filter @workspace/api-server migrate:gcs-to-spe              # full run
//
// Env required (same as the api-server itself):
//   DATABASE_URL, ENTRA_TENANT_ID, ENTRA_APP_CLIENT_ID,
//   ENTRA_APP_CLIENT_SECRET, PUBLIC_OBJECT_SEARCH_PATHS,
//   PRIVATE_OBJECT_DIR. site_settings must have a container ID for
//   the active environment (NODE_ENV→ slot) and speStorageEnabled=true
//   isn't required (the script targets SPE directly via fileStorage).

import { eq, isNull, count } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import { GcsAssetStorageBackend } from "../lib/storage/gcsBackend";
import { speFileStorage, SpeNotEnabledError } from "../lib/storage/spe/fileStorage";

interface Args {
  dryRun: boolean;
  limit: number | null;
  pageSize: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, limit: null, pageSize: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--limit needs a positive integer");
      out.limit = n;
    } else if (a === "--page-size") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--page-size needs a positive integer");
      out.pageSize = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: migrate:gcs-to-spe [--dry-run] [--limit N] [--page-size N]",
          "",
          "  --dry-run      list rows that would be migrated; don't touch SPE or DB",
          "  --limit N      stop after N rows successfully migrated",
          "  --page-size N  rows fetched per DB page (default 50)",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

async function streamGcsToBuffer(
  gcs: GcsAssetStorageBackend,
  storageKey: string,
): Promise<{ body: Buffer; contentType: string }> {
  const ref = await gcs.getObjectEntityFile(storageKey);
  const response = await gcs.downloadObject(ref);
  const arrayBuf = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return { body: Buffer.from(arrayBuf), contentType };
}

async function migrateOne(
  gcs: GcsAssetStorageBackend,
  row: {
    id: string;
    storageKey: string;
    originalName: string | null;
    altText: string;
    mime: string | null;
  },
  dryRun: boolean,
): Promise<{ ok: true; itemId: string; containerId: string } | { ok: false; reason: string }> {
  if (dryRun) {
    return { ok: true, itemId: "(dry-run)", containerId: "(dry-run)" };
  }
  let body: Buffer;
  let contentType: string;
  try {
    const fetched = await streamGcsToBuffer(gcs, row.storageKey);
    body = fetched.body;
    // Prefer the row's stored mime over the response header — the
    // response can be wrong for objects served through a CDN that
    // stripped the content-type.
    contentType = row.mime ?? fetched.contentType;
  } catch (err) {
    return { ok: false, reason: `gcs fetch: ${(err as Error).message}` };
  }
  const filename = row.originalName ?? row.altText.slice(0, 120) ?? row.id;
  let stored;
  try {
    stored = await speFileStorage.storeFile({
      body,
      filename,
      contentType,
      documentType: "media",
      ownerId: row.id,
    });
  } catch (err) {
    return { ok: false, reason: `spe upload: ${(err as Error).message}` };
  }
  // ATOMIC: only set the overlay columns. storage_key stays as-is so
  // a subsequent rollback (UPDATE media SET spe_file_id = NULL WHERE id = ?)
  // is sufficient to restore GCS reads.
  try {
    await db
      .update(mediaTable)
      .set({ speFileId: stored.itemId, speContainerId: stored.containerId })
      .where(eq(mediaTable.id, row.id));
  } catch (err) {
    return {
      ok: false,
      reason: `db update failed AFTER spe upload (orphan in SPE: ${stored.itemId}): ${(err as Error).message}`,
    };
  }
  return { ok: true, itemId: stored.itemId, containerId: stored.containerId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Ensure SPE config is reachable up-front so we don't fail mid-batch.
  if (!args.dryRun) {
    try {
      await speFileStorage.resolveContainerId();
    } catch (err) {
      if (err instanceof SpeNotEnabledError) {
        console.error(`SPE not configured: ${err.message}`);
      } else {
        console.error(`SPE preflight failed:`, err);
      }
      process.exit(1);
    }
  }

  const gcs = new GcsAssetStorageBackend();

  // Pre-flight counts.
  const [totalRow] = await db.select({ n: count() }).from(mediaTable);
  const [pendingRow] = await db
    .select({ n: count() })
    .from(mediaTable)
    .where(isNull(mediaTable.speFileId));
  const total = totalRow?.n ?? 0;
  const pending = pendingRow?.n ?? 0;

  console.log(
    `media: ${total} total · ${total - pending} already migrated · ${pending} pending` +
      (args.dryRun ? " (DRY RUN)" : "") +
      (args.limit ? ` (limit=${args.limit})` : ""),
  );

  if (pending === 0) {
    console.log("Nothing to do.");
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  // Page through pending rows in createdAt order. Each page re-queries
  // so a crash mid-run picks up from wherever we got to (the WHERE
  // spe_file_id IS NULL filter does the work).
  while (true) {
    if (args.limit !== null && succeeded >= args.limit) break;

    const remaining = args.limit !== null ? args.limit - succeeded : args.pageSize;
    const pageLimit = Math.min(remaining, args.pageSize);
    const page = await db
      .select({
        id: mediaTable.id,
        storageKey: mediaTable.storageKey,
        originalName: mediaTable.originalName,
        altText: mediaTable.altText,
        mime: mediaTable.mime,
      })
      .from(mediaTable)
      .where(isNull(mediaTable.speFileId))
      .orderBy(mediaTable.createdAt)
      .limit(pageLimit);

    if (page.length === 0) break;

    for (const row of page) {
      processed++;
      const result = await migrateOne(gcs, row, args.dryRun);
      if (result.ok) {
        succeeded++;
        console.log(
          `  ✓ ${row.id} → ${result.itemId}` +
            (args.dryRun ? "" : ` (${result.containerId})`),
        );
      } else {
        failed++;
        failures.push({ id: row.id, reason: result.reason });
        console.error(`  ✗ ${row.id}: ${result.reason}`);
      }
      if (args.limit !== null && succeeded >= args.limit) break;
    }
  }

  console.log(
    `\nDone. processed=${processed} succeeded=${succeeded} failed=${failed}` +
      (args.dryRun ? " (DRY RUN — nothing written)" : ""),
  );
  if (failures.length > 0) {
    console.error(`\n${failures.length} failures:`);
    for (const f of failures) console.error(`  ${f.id}  ${f.reason}`);
    process.exit(1);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
