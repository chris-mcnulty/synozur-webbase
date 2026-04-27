import type { ObjectAclPolicy } from "../objectAcl";

// Opaque to callers — backends may carry extra fields on their own ref types.
// `storageKey` is the canonical "/objects/<id>"-style path that admin tables
// (`assets.storage_key`, `media.storage_key`) persist.
export interface AssetObjectRef {
  readonly storageKey: string;
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
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}
