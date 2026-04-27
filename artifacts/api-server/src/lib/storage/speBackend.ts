import type { ObjectAclPolicy } from "../objectAcl";
import type { AssetObjectRef, AssetStorageBackend } from "./types";

// SharePoint Embedded driver (#127 Phase 2). Phase 1 lands the abstraction
// only — the SPE container, Entra app-reg with `FileStorageContainer.Selected`,
// and the Graph wiring are still pending. Selecting `STORAGE_BACKEND=spe`
// today fails fast at first use rather than at boot, so the GCS path stays
// unchanged for any deployment that hasn't opted in.
const NOT_CONFIGURED =
  "SharePoint Embedded backend not yet implemented (#127 Phase 2). " +
  "Set STORAGE_BACKEND=gcs (or unset) to use the existing GCS path.";

export class SpeAssetStorageBackend implements AssetStorageBackend {
  readonly name = "spe" as const;

  searchPublicObject(_filePath: string): Promise<AssetObjectRef | null> {
    throw new Error(NOT_CONFIGURED);
  }

  downloadObject(_ref: AssetObjectRef, _cacheTtlSec?: number): Promise<Response> {
    throw new Error(NOT_CONFIGURED);
  }

  getObjectEntityUploadURL(): Promise<string> {
    throw new Error(NOT_CONFIGURED);
  }

  getObjectEntityFile(_objectPath: string): Promise<AssetObjectRef> {
    throw new Error(NOT_CONFIGURED);
  }

  normalizeObjectEntityPath(_rawPath: string): string {
    throw new Error(NOT_CONFIGURED);
  }

  getObjectAclPolicy(_ref: AssetObjectRef): Promise<ObjectAclPolicy | null> {
    throw new Error(NOT_CONFIGURED);
  }

  setObjectAclPolicy(_ref: AssetObjectRef, _policy: ObjectAclPolicy): Promise<void> {
    throw new Error(NOT_CONFIGURED);
  }

  deleteObject(_ref: AssetObjectRef): Promise<void> {
    throw new Error(NOT_CONFIGURED);
  }
}
