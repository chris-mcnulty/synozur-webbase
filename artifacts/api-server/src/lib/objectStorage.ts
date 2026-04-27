// #127 Phase 1 — pluggable asset-storage backends.
//
// `ObjectStorageService` is the single entry point that routes, the upload
// flow, and the AssetLibrary/MediaPicker pipelines hit. It now delegates to
// an `AssetStorageBackend` selected by the `STORAGE_BACKEND` env var:
//   STORAGE_BACKEND=gcs  (default) — Replit-sidecar Google Cloud Storage
//   STORAGE_BACKEND=spe             — SharePoint Embedded (Phase 2 stub)
//
// Public API and behavior are unchanged versus pre-Phase-1; only the
// internals split into `./storage/{types,gcsBackend,speBackend}`.

import {
  type ObjectAclPolicy,
  ObjectPermission,
  canAccessByPolicy,
} from "./objectAcl";
import type { AssetObjectRef, AssetStorageBackend } from "./storage/types";
import { ObjectNotFoundError } from "./storage/types";
import { GcsAssetStorageBackend, objectStorageClient } from "./storage/gcsBackend";
import { SpeAssetStorageBackend } from "./storage/speBackend";

export { ObjectNotFoundError };
export type { AssetObjectRef };
// Re-exported for the legacy `seedHomepageAssets.ts` script which still
// reaches into the GCS client directly. Will retire alongside the
// `assets`-table cleanup tracked in BACKLOG.md.
export { objectStorageClient };

function selectBackend(): AssetStorageBackend {
  const choice = (process.env.STORAGE_BACKEND ?? "gcs").trim().toLowerCase();
  switch (choice) {
    case "":
    case "gcs":
      return new GcsAssetStorageBackend();
    case "spe":
      return new SpeAssetStorageBackend();
    default:
      throw new Error(
        `Unknown STORAGE_BACKEND='${choice}'. Expected 'gcs' or 'spe'.`,
      );
  }
}

export class ObjectStorageService {
  private readonly backend: AssetStorageBackend;

  constructor(backend?: AssetStorageBackend) {
    this.backend = backend ?? selectBackend();
  }

  searchPublicObject(filePath: string): Promise<AssetObjectRef | null> {
    return this.backend.searchPublicObject(filePath);
  }

  downloadObject(ref: AssetObjectRef, cacheTtlSec?: number): Promise<Response> {
    return this.backend.downloadObject(ref, cacheTtlSec);
  }

  getObjectEntityUploadURL(): Promise<string> {
    return this.backend.getObjectEntityUploadURL();
  }

  getObjectEntityFile(objectPath: string): Promise<AssetObjectRef> {
    return this.backend.getObjectEntityFile(objectPath);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return this.backend.normalizeObjectEntityPath(rawPath);
  }

  deleteObject(ref: AssetObjectRef): Promise<void> {
    return this.backend.deleteObject(ref);
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.backend.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const ref = await this.backend.getObjectEntityFile(normalizedPath);
    await this.backend.setObjectAclPolicy(ref, aclPolicy);
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
    const policy = await this.backend.getObjectAclPolicy(ref);
    return canAccessByPolicy({
      userId,
      policy,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
