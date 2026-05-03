// #127 Phase 3-C — orphan reconciliation for SharePoint Embedded.
//
// Why orphans happen: in SPE, `media.spe_file_id` is the only link from
// the app back to a drive item. If the database is reset (delete-recreate
// cycle, dev-environment teardown), the SPE container's bytes survive
// but every link from the app is severed. There's no path-shaped key to
// reconstruct the mapping from. Orphans accumulate.
//
// What this scan does: list every drive item in the active container,
// compare against the set of `spe_file_id`s currently in `media`, flag
// anything not in the DB as an orphan. A 2-hour age threshold protects
// in-flight uploads that have completed the SPE PUT but haven't yet
// landed their `media` row (the upload cache TTL is 5 minutes; 2 hours
// is generous).
//
// `cleanup` deletes the listed items; the caller passes `dryRun: true`
// by default so this is opt-in destructive. Same operational shape as
// the migration script — the actual delete only runs when an admin
// explicitly asks for it.

import { isNotNull } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import { speFileStorage } from "./fileStorage";
import type { SpeFileItem } from "./graphClient";

const SAFE_AGE_HOURS = 2;
const SAFE_AGE_MS = SAFE_AGE_HOURS * 60 * 60 * 1000;

export interface OrphanItem {
  id: string;                    // SharePoint drive item id
  name: string;
  size: number;
  contentType: string;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  ageHours: number | null;
}

export interface OrphanScanResult {
  containerId: string;
  totalInContainer: number;
  knownInDb: number;
  orphanCount: number;
  orphanBytes: number;
  // Items not in DB but younger than SAFE_AGE_HOURS (or with no timestamp).
  // Non-zero here means the scanner found unrecognised files but is holding
  // off on flagging them; after 2 hours they become eligible orphans.
  skippedByAge: number;
  // Capped — the route response stays bounded. Cleanup uses `cleanup()`
  // which does its own paged listing, so even huge orphan counts are
  // handle-able.
  sample: OrphanItem[];
  sampleCapped: boolean;
}

const SAMPLE_CAP = 200;

async function loadKnownSpeFileIds(): Promise<Set<string>> {
  const rows = await db
    .select({ speFileId: mediaTable.speFileId })
    .from(mediaTable)
    .where(isNotNull(mediaTable.speFileId));
  const set = new Set<string>();
  for (const r of rows) {
    if (r.speFileId) set.add(r.speFileId);
  }
  return set;
}

function isOldEnough(item: SpeFileItem, now: number): boolean {
  const ts = item.createdDateTime ? Date.parse(item.createdDateTime) : NaN;
  // Unknown timestamp → treat as NOT old enough. Conservative: if Graph
  // didn't return createdDateTime we don't actually know the age, so
  // skip the item from orphan deletion rather than risk wiping a
  // newly-created or in-flight item with incomplete metadata.
  if (Number.isNaN(ts)) return false;
  return now - ts > SAFE_AGE_MS;
}

function ageHours(item: SpeFileItem, now: number): number | null {
  const ts = item.createdDateTime ? Date.parse(item.createdDateTime) : NaN;
  if (Number.isNaN(ts)) return null;
  return Math.round(((now - ts) / (60 * 60 * 1000)) * 10) / 10;
}

function toOrphanItem(item: SpeFileItem, now: number): OrphanItem {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    contentType: item.contentType,
    webUrl: item.webUrl,
    createdDateTime: item.createdDateTime,
    lastModifiedDateTime: item.lastModifiedDateTime,
    ageHours: ageHours(item, now),
  };
}

export async function scanOrphans(): Promise<OrphanScanResult> {
  const containerId = await speFileStorage.resolveContainerId();
  const known = await loadKnownSpeFileIds();
  // `listFiles()` already returns only file-kind items via recursive
  // walk; the explicit filter here is defense-in-depth so a future
  // refactor that loosens listFiles can't accidentally make folders
  // candidates for cleanup.
  const all = (await speFileStorage.listFiles()).filter(
    (item) => item.kind === "file",
  );
  const now = Date.now();

  const orphans: OrphanItem[] = [];
  let orphanBytes = 0;
  let totalOldEnough = 0;
  let skippedByAge = 0;
  for (const item of all) {
    if (known.has(item.id)) continue;
    if (!isOldEnough(item, now)) {
      skippedByAge++;
      continue;
    }
    totalOldEnough++;
    orphanBytes += item.size;
    if (orphans.length < SAMPLE_CAP) {
      orphans.push(toOrphanItem(item, now));
    }
  }

  return {
    containerId,
    totalInContainer: all.length,
    knownInDb: known.size,
    orphanCount: totalOldEnough,
    orphanBytes,
    skippedByAge,
    sample: orphans,
    sampleCapped: totalOldEnough > orphans.length,
  };
}

export interface CleanupOptions {
  dryRun: boolean;
  maxDelete?: number;
  // Optional explicit list — if provided we only delete these item ids
  // (and only if they pass the same orphan + age checks scanOrphans uses).
  // Lets the admin UI show a sample, then delete just those.
  itemIds?: string[];
}

export interface CleanupResult {
  containerId: string;
  attempted: number;
  deleted: number;
  skipped: number;
  failures: Array<{ id: string; reason: string }>;
}

export async function cleanupOrphans(
  opts: CleanupOptions,
): Promise<CleanupResult> {
  const containerId = await speFileStorage.resolveContainerId();
  const known = await loadKnownSpeFileIds();
  // Same belt-and-braces filter as scanOrphans — folders must never
  // be cleanup candidates regardless of any future listFiles change.
  const all = (await speFileStorage.listFiles()).filter(
    (item) => item.kind === "file",
  );
  const now = Date.now();

  const candidates = all.filter(
    (item) => !known.has(item.id) && isOldEnough(item, now),
  );
  const filtered = opts.itemIds
    ? candidates.filter((c) => opts.itemIds!.includes(c.id))
    : candidates;
  const cap = opts.maxDelete ?? 100;
  const subject = filtered.slice(0, cap);

  let deleted = 0;
  const skipped = filtered.length - subject.length;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const item of subject) {
    if (opts.dryRun) {
      deleted++;
      continue;
    }
    try {
      await speFileStorage.deleteFile(item.id);
      deleted++;
    } catch (err) {
      failures.push({ id: item.id, reason: (err as Error).message });
    }
  }

  return {
    containerId,
    attempted: subject.length,
    deleted,
    skipped,
    failures,
  };
}

// Round-trip test: upload a synthetic small file, verify it reads back
// with the same bytes, then delete it. Returns timing per phase plus the
// drive item id (so an operator can verify in SharePoint admin if the
// delete somehow doesn't take). Used by the SPE admin page's "Test
// upload" button to validate end-to-end provisioning before any real
// data is involved.
export interface RoundTripResult {
  ok: boolean;
  containerId: string;
  itemId: string;
  uploadedSize: number;
  readbackSize: number;
  bytesMatch: boolean;
  timings: { upload: number; readback: number; delete: number };
}

export async function speRoundTripTest(): Promise<RoundTripResult> {
  const containerId = await speFileStorage.resolveContainerId();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `roundtrip-test-${stamp}.txt`;
  // Use a small but non-trivial body so we exercise both the byte
  // round-trip and any chunking thresholds. 2 KB is well under the
  // 4 MB simple-upload limit.
  const body = Buffer.from(
    `Synozur SPE round-trip test\nstamp=${stamp}\n` + "x".repeat(1500),
    "utf8",
  );

  const t0 = Date.now();
  const stored = await speFileStorage.storeFile({
    body,
    filename,
    contentType: "text/plain",
    documentType: "media",
    ownerId: "roundtrip-test",
  });
  const t1 = Date.now();

  const readback = await speFileStorage.getFile(stored.itemId);
  const readbackBuf = Buffer.from(await readback.arrayBuffer());
  const t2 = Date.now();

  let deleteOk = true;
  try {
    await speFileStorage.deleteFile(stored.itemId);
  } catch {
    deleteOk = false;
  }
  const t3 = Date.now();

  return {
    ok: body.length === readbackBuf.length && body.equals(readbackBuf) && deleteOk,
    containerId,
    itemId: stored.itemId,
    uploadedSize: body.length,
    readbackSize: readbackBuf.length,
    bytesMatch: body.equals(readbackBuf),
    timings: { upload: t1 - t0, readback: t2 - t1, delete: t3 - t2 },
  };
}
