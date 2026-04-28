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

type ActiveBackendName = "gcs" | "spe";

function readActiveBackendName(): ActiveBackendName {
  const choice = (process.env.STORAGE_BACKEND ?? "gcs").trim().toLowerCase();
  switch (choice) {
    case "":
    case "gcs":
      return "gcs";
    case "spe":
      return "spe";
    default:
      throw new Error(
        `Unknown STORAGE_BACKEND='${choice}'. Expected 'gcs' or 'spe'.`,
      );
  }
}

export class ObjectStorageService {
  private readonly gcs: GcsAssetStorageBackend;
  private readonly spe: SpeAssetStorageBackend;
  private readonly active: AssetStorageBackend;

  constructor(activeOverride?: ActiveBackendName) {
    this.gcs = new GcsAssetStorageBackend();
    this.spe = new SpeAssetStorageBackend();
    const activeName = activeOverride ?? readActiveBackendName();
    this.active = activeName === "spe" ? this.spe : this.gcs;
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

  // Writes: go to the active backend.
  uploadObject(opts: UploadObjectOptions): Promise<AssetObjectRef> {
    return this.active.uploadObject(opts);
  }

  getObjectEntityUploadURL(): Promise<string> {
    return this.active.getObjectEntityUploadURL();
  }

  // Path lookups + normalization are GCS-shaped idioms. They run
  // against the active backend; the SPE backend throws clearly when
  // a caller invokes them on the wrong backend.
  searchPublicObject(filePath: string): Promise<AssetObjectRef | null> {
    return this.active.searchPublicObject(filePath);
  }

  getObjectEntityFile(objectPath: string): Promise<AssetObjectRef> {
    return this.active.getObjectEntityFile(objectPath);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return this.active.normalizeObjectEntityPath(rawPath);
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.active.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const ref = await this.active.getObjectEntityFile(normalizedPath);
    await this.active.setObjectAclPolicy(ref, aclPolicy);
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
  // from the DB columns without needing to re-query.
  speRef(storageKey: string, speFileId: string): AssetObjectRef {
    return { storageKey, speFileId };
  }
}
