// Shared GCS → SPE migration logic.
// Used by the CLI script (migrateGcsToSpe.ts) and the admin API
// (speAdmin.ts). Keeps the two surfaces in sync without duplication.

import { eq, isNull, count } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import { GcsAssetStorageBackend } from "../gcsBackend";
import { speFileStorage } from "./fileStorage";

export interface MigrationOptions {
  dryRun: boolean;
  limit: number | null;
  pageSize?: number;
  onRow?: (id: string, ok: boolean, detail: string) => void;
}

export interface MigrationCounts {
  total: number;
  alreadyMigrated: number;
  pending: number;
}

export interface MigrationResult extends MigrationCounts {
  processed: number;
  succeeded: number;
  failed: number;
  failures: Array<{ id: string; reason: string }>;
}

async function streamGcsToBuffer(
  gcs: GcsAssetStorageBackend,
  storageKey: string,
): Promise<{ body: Buffer; contentType: string }> {
  const ref = await gcs.getObjectEntityFile(storageKey);
  const response = await gcs.downloadObject(ref);
  const arrayBuf = await response.arrayBuffer();
  return {
    body: Buffer.from(arrayBuf),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
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
  if (dryRun) return { ok: true, itemId: "(dry-run)", containerId: "(dry-run)" };

  let body: Buffer;
  let contentType: string;
  try {
    const fetched = await streamGcsToBuffer(gcs, row.storageKey);
    body = fetched.body;
    // Prefer the DB-stored mime — CDNs can strip content-type from GCS
    // response headers, making the raw response unreliable.
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

  try {
    await db
      .update(mediaTable)
      .set({ speFileId: stored.itemId, speContainerId: stored.containerId })
      .where(eq(mediaTable.id, row.id));
  } catch (err) {
    return {
      ok: false,
      reason: `db update failed AFTER spe upload — orphan in SPE: ${stored.itemId}: ${(err as Error).message}`,
    };
  }

  return { ok: true, itemId: stored.itemId, containerId: stored.containerId };
}

export async function fetchMigrationCounts(): Promise<MigrationCounts> {
  const [totalRow] = await db.select({ n: count() }).from(mediaTable);
  const [pendingRow] = await db
    .select({ n: count() })
    .from(mediaTable)
    .where(isNull(mediaTable.speFileId));
  const total = totalRow?.n ?? 0;
  const pending = pendingRow?.n ?? 0;
  return { total, alreadyMigrated: total - pending, pending };
}

export async function runMigration(opts: MigrationOptions): Promise<MigrationResult> {
  const pageSize = opts.pageSize ?? 50;

  // Preflight — fail fast rather than discovering mid-batch that SPE is
  // not configured. resolveContainerId() throws SpeNotEnabledError with
  // a clear message if credentials or container id are missing.
  if (!opts.dryRun) {
    await speFileStorage.resolveContainerId();
  }

  const gcs = new GcsAssetStorageBackend();
  const counts = await fetchMigrationCounts();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  // In dry-run mode rows are never updated, so the WHERE spe_file_id IS NULL
  // filter would return the same page on every iteration — an infinite loop.
  // Use an explicit offset to advance through the result set instead.
  let dryRunOffset = 0;

  while (true) {
    if (opts.limit !== null && succeeded >= opts.limit) break;

    const remaining = opts.limit !== null ? opts.limit - succeeded : pageSize;
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
      .limit(Math.min(remaining, pageSize))
      .offset(opts.dryRun ? dryRunOffset : 0);

    if (page.length === 0) break;

    for (const row of page) {
      processed++;
      const result = await migrateOne(gcs, row, opts.dryRun);
      if (result.ok) {
        succeeded++;
        opts.onRow?.(row.id, true, result.itemId);
      } else {
        failed++;
        failures.push({ id: row.id, reason: result.reason });
        opts.onRow?.(row.id, false, result.reason);
      }
      if (opts.limit !== null && succeeded >= opts.limit) break;
    }

    // Advance the offset after each page in dry-run mode.
    if (opts.dryRun) dryRunOffset += page.length;
  }

  return { ...counts, processed, succeeded, failed, failures };
}
