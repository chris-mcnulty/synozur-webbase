// #127 — pluggable asset-storage backends with read-side dispatch.
//
// `ObjectStorageService` holds BOTH backends and chooses per-call:
//
//   • Writes (uploadObject, getObjectEntityUploadURL) go to the
//     `active` backend chosen by the STORAGE_BACKEND env var:
//       STORAGE_BACKEND=gcs  (default) — Replit-sidecar GCS
//       STORAGE_BACKEND=spe             — SharePoint Embedded
//
//   • Reads (downloadObject, deleteObject) route by `AssetObjectRef`
//     shape: a ref carrying `speFileId` reads/deletes via SPE; a ref
//     without it reads/deletes via GCS. This is the cutover pattern —
//     during the migration window both backends are reachable so the
//     `media.spe_file_id` overlay column resolves to either side per
//     row, while new uploads always go to whichever backend is active.
//
// Phase 3 read-path-fallback invariant: GCS bytes are NEVER deleted by
// the migration script or any read path. The bucket stays authoritative
// behind every row's `media.storage_key` until decommissioned manually
// post-soak. If we ever need to roll a row back from SPE, clearing
// `media.spe_file_id` is sufficient — the bytes are right where they
// were.

import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";
import {
  type ObjectAclPolicy,
  ObjectPermission,
  canAccessByPolicy,
} from "./objectAcl";
import type {
  AssetObjectRef,
  AssetStorageBackend,
  UploadObjectOptions,
} from "./storage/types";
import { ObjectNotFoundError } from "./storage/types";
import { GcsAssetStorageBackend, objectStorageClient } from "./storage/gcsBackend";
import { SpeAssetStorageBackend } from "./storage/speBackend";

export { ObjectNotFoundError };
export type { AssetObjectRef };
// Re-exported for the legacy `seedHomepageAssets.ts` script which still
// reaches into the GCS client directly. Will retire alongside the
// `assets`-table cleanup tracked in BACKLOG.md.
export { objectStorageClient };

export type ActiveBackendName = "gcs" | "spe";

// ---------------------------------------------------------------------------
// Per-slot backend cache — reads site_settings once every 30 s so the admin
// can switch dev ↔ prod backends from the UI without a server restart or
// redeploy. The env var STORAGE_BACKEND acts as a hard override (useful for
// emergency rollback via deployment secrets without touching the DB).
// ---------------------------------------------------------------------------

const SETTINGS_ID = 1;
const BACKEND_CACHE_TTL_MS = 30_000;

type CacheEntry = { value: ActiveBackendName; expiresAt: number };
const backendCache: Record<"dev" | "prod", CacheEntry | null> = {
  dev: null,
  prod: null,
};

/** Call after a successful PATCH to /settings so the new choice applies immediately. */
export function invalidateBackendCache(): void {
  backendCache.dev = null;
  backendCache.prod = null;
}

async function resolveActiveBackendName(
  override?: ActiveBackendName,
): Promise<ActiveBackendName> {
  if (override) return override;

  const slot: "dev" | "prod" =
    process.env["NODE_ENV"] === "production" ? "prod" : "dev";

  const cached = backendCache[slot];
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const settings = await db.query.siteSettingsTable.findFirst({
    where: eq(siteSettingsTable.id, SETTINGS_ID),
    columns: { storageBackendDev: true, storageBackendProd: true },
  });
  const raw =
    slot === "prod" ? settings?.storageBackendProd : settings?.storageBackendDev;
  const value: ActiveBackendName = raw === "spe" ? "spe" : "gcs";
  backendCache[slot] = { value, expiresAt: Date.now() + BACKEND_CACHE_TTL_MS };
  return value;
}

export class ObjectStorageService {
  private readonly gcs: GcsAssetStorageBackend;
  private readonly spe: SpeAssetStorageBackend;
  /** Set when constructed with an explicit override; null means use DB cache. */
  private readonly activeOverride: ActiveBackendName | undefined;

  constructor(activeOverride?: ActiveBackendName) {
    this.gcs = new GcsAssetStorageBackend();
    this.spe = new SpeAssetStorageBackend();
    this.activeOverride = activeOverride;
  }

  private async resolveActive(): Promise<AssetStorageBackend> {
    const name = await resolveActiveBackendName(this.activeOverride);
    return name === "spe" ? this.spe : this.gcs;
  }

  // Read-side dispatch: ref shape decides which backend serves it.
  // A ref with `speFileId` was minted by a migrated row; everything
  // else is the legacy GCS shape.
  private backendForRef(ref: AssetObjectRef): AssetStorageBackend {
    return ref.speFileId ? this.spe : this.gcs;
  }

  // Reads: dispatch by ref shape.
  downloadObject(ref: AssetObjectRef, cacheTtlSec?: number): Promise<Response> {
    return this.backendForRef(ref).downloadObject(ref, cacheTtlSec);
  }

  deleteObject(ref: AssetObjectRef): Promise<void> {
    return this.backendForRef(ref).deleteObject(ref);
  }

  // Writes: go to the active backend (resolved per-request from DB cache).
  async uploadObject(opts: UploadObjectOptions): Promise<AssetObjectRef> {
    return (await this.resolveActive()).uploadObject(opts);
  }

  async getObjectEntityUploadURL(): Promise<string> {
    return (await this.resolveActive()).getObjectEntityUploadURL();
  }

  // Path lookups + normalization are GCS-shaped idioms (`/objects/...`,
  // `/public-objects/...`, `https://storage.googleapis.com/...`). The
  // SPE backend has no equivalent and the migration is additive, so
  // these always route through the GCS backend regardless of which
  // backend is "active" for writes. Without this dispatch the storage
  // route's GCS-fallback branch and the public-objects route would
  // throw whenever STORAGE_BACKEND=spe even though the bytes still
  // live in the bucket. Once `assets`/legacy public-objects are
  // retired, these can move to the active backend.
  searchPublicObject(filePath: string): Promise<AssetObjectRef | null> {
    return this.gcs.searchPublicObject(filePath);
  }

  getObjectEntityFile(objectPath: string): Promise<AssetObjectRef> {
    return this.gcs.getObjectEntityFile(objectPath);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return this.gcs.normalizeObjectEntityPath(rawPath);
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.gcs.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const ref = await this.gcs.getObjectEntityFile(normalizedPath);
    await this.gcs.setObjectAclPolicy(ref, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    ref,
    requestedPermission,
  }: {
    userId?: string;
    ref: AssetObjectRef;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const policy = await this.backendForRef(ref).getObjectAclPolicy(ref);
    return canAccessByPolicy({
      userId,
      policy,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  // Build a ref that points at the SPE side of a migrated media row.
  // Used by the storage route's overlay-resolution to construct a ref
  // from the DB columns without needing to re-query. Pass speContainerId
  // through so reads/deletes target the container that physically holds
  // the item (recorded on `media.spe_container_id`) — protects against
  // site_settings rotation invalidating older rows.
  speRef(
    storageKey: string,
    speFileId: string,
    speContainerId?: string,
  ): AssetObjectRef {
    return { storageKey, speFileId, speContainerId };
  }
}
