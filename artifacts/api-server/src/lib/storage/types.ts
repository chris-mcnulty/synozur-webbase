import type { ObjectAclPolicy } from "../objectAcl";

// Opaque to callers — backends may carry extra fields on their own ref types.
// `storageKey` is the canonical "/objects/<id>"-style path that admin tables
// (`assets.storage_key`, `media.storage_key`) persist for GCS-backed objects.
// SPE-backed refs carry the SharePoint drive item id via `speFileId`; the
// `media.storage_key` column stays populated with the original GCS path
// post-migration (additive-overlay pattern).
export interface AssetObjectRef {
  readonly storageKey: string;
  readonly speFileId?: string;
}

// Server-side upload — the Orbit pattern. The api-server receives bytes
// (from a multipart route or an internal caller like the migration script)
// and pushes them to the storage backend in one call. Replaces the older
// presigned-URL flow for SPE; the GCS backend implements both so existing
// callers keep working through the cutover.
export interface UploadObjectOptions {
  body: Buffer;
  contentType: string;
  filename: string;
  // Logical category — informs folder placement on the SPE side and is
  // stamped onto the SharePoint list-item field for orphan analysis.
  documentType: "media" | "attachment";
  // Owner row id (e.g. `media.id` UUID) — used as a folder-prefix shard
  // and recorded on metadata so orphans can be reconciled against the DB.
  ownerId: string;
  // For audit/provenance.
  uploadedByUserId?: string;
}

export interface AssetStorageBackend {
  readonly name: "gcs" | "spe";

  searchPublicObject(filePath: string): Promise<AssetObjectRef | null>;
  downloadObject(ref: AssetObjectRef, cacheTtlSec?: number): Promise<Response>;
  getObjectEntityUploadURL(): Promise<string>;
  getObjectEntityFile(objectPath: string): Promise<AssetObjectRef>;
  normalizeObjectEntityPath(rawPath: string): string;

  getObjectAclPolicy(ref: AssetObjectRef): Promise<ObjectAclPolicy | null>;
  setObjectAclPolicy(ref: AssetObjectRef, policy: ObjectAclPolicy): Promise<void>;

  deleteObject(ref: AssetObjectRef): Promise<void>;

  uploadObject(opts: UploadObjectOptions): Promise<AssetObjectRef>;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}
