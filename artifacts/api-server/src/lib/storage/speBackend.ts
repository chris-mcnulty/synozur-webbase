// #127 Phase 2 — SharePoint Embedded backend.
//
// Implements the AssetStorageBackend interface by delegating to the
// SpeFileStorage layer. Several method signatures don't map cleanly to
// SPE primitives — those are documented inline:
//
//   • getObjectEntityUploadURL: SPE has no presigned-URL flow. Throws
//     until an internal direct-upload route is wired in Phase 3 and
//     the AssetLibrary/MediaPicker client is updated to POST bytes
//     instead of asking for a URL.
//   • searchPublicObject / normalizeObjectEntityPath: GCS-bucket-path
//     idioms with no SPE equivalent. Throws — the public-object route
//     needs reworking to read through the api-server with auth caching
//     when SPE is enabled.
//
// Read-path resolution: when SPE is the active backend, the `/api/storage/...`
// resolver expects refs to carry `speFileId`. Phase 3 adds the schema
// columns + read-path branch that materialises this; until then any
// caller that constructs a ref from a legacy `/objects/<uuid>` path
// will fail at fetch time with a clear "no spe_file_id" error.

import type { ObjectAclPolicy } from "../objectAcl";
import type {
  AssetObjectRef,
  AssetStorageBackend,
  UploadObjectOptions,
} from "./types";
import { ObjectNotFoundError } from "./types";
import { speFileStorage } from "./spe/fileStorage";

const NOT_SUPPORTED_PRESIGNED =
  "SharePoint Embedded does not expose presigned upload URLs. " +
  "Use the server-proxied uploadObject() flow (or the corresponding " +
  "api-server route, once wired in Phase 3).";

const NOT_SUPPORTED_PUBLIC_PATHS =
  "SharePoint Embedded has no equivalent of PUBLIC_OBJECT_SEARCH_PATHS. " +
  "Public-object reads must go through the api-server with cached auth " +
  "(routing change pending Phase 3 cutover).";

const NOT_SUPPORTED_NORMALIZE =
  "normalizeObjectEntityPath is GCS-specific (storage.googleapis.com URL " +
  "stripping). SPE refs are identified by drive item id, not URL path.";

// SPE refs carry speFileId; storageKey holds a synthetic /spe/<itemId>
// path so the existing column types (text storage_key) keep accepting
// them during the additive-overlay migration window. The read-path in
// routes/storage.ts will branch on speFileId-presence in Phase 3.
function speRef(itemId: string, containerId?: string): AssetObjectRef {
  return { storageKey: `/spe/${itemId}`, speFileId: itemId, speContainerId: containerId };
}

function asSpeFileId(ref: AssetObjectRef): string {
  if (ref.speFileId) return ref.speFileId;
  if (ref.storageKey.startsWith("/spe/")) return ref.storageKey.slice("/spe/".length);
  throw new Error(
    `Ref ${JSON.stringify(ref)} has no speFileId — likely a legacy GCS ref reached the SPE backend without migration`,
  );
}

export class SpeAssetStorageBackend implements AssetStorageBackend {
  readonly name = "spe" as const;

  searchPublicObject(_filePath: string): Promise<AssetObjectRef | null> {
    throw new Error(NOT_SUPPORTED_PUBLIC_PATHS);
  }

  async downloadObject(
    ref: AssetObjectRef,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const itemId = asSpeFileId(ref);
    let upstream: Response;
    try {
      // If the ref carries the container the row was written to, use
      // it — protects against site_settings.spe_container_id_* rotation
      // making old media.spe_file_id values 404 against the wrong
      // container.
      upstream = await speFileStorage.getFile(itemId, ref.speContainerId);
    } catch (err) {
      // Surface a clean ObjectNotFoundError so the storage route returns
      // 404 instead of 500 when an SPE item id has been deleted/rotated.
      if (
        err instanceof Error &&
        /404|notFound|itemNotFound/i.test(err.message)
      ) {
        throw new ObjectNotFoundError();
      }
      throw err;
    }

    // Translate Graph's response into a same-shape Response with our own
    // Cache-Control. Drop SharePoint-specific headers that would confuse
    // downstream proxies. ACL visibility is intentionally not consulted
    // here — `routes/storage.ts` performs the access check before
    // calling downloadObject; SPE itself is the auth boundary for the
    // raw bytes.
    const headers = new Headers();
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    headers.set("Cache-Control", `private, max-age=${cacheTtlSec}`);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  getObjectEntityUploadURL(): Promise<string> {
    throw new Error(NOT_SUPPORTED_PRESIGNED);
  }

  async getObjectEntityFile(objectPath: string): Promise<AssetObjectRef> {
    // Accept both /spe/<itemId> (post-migration native) and bare item ids
    // (internal callers like the migration script).
    if (objectPath.startsWith("/spe/")) {
      return speRef(objectPath.slice("/spe/".length));
    }
    if (objectPath.startsWith("/objects/")) {
      // Legacy GCS-shaped path — the SPE backend can't resolve these
      // until the migration overlay lands. Fail clearly so the caller
      // knows they hit the wrong backend.
      throw new ObjectNotFoundError();
    }
    return speRef(objectPath);
  }

  normalizeObjectEntityPath(_rawPath: string): string {
    throw new Error(NOT_SUPPORTED_NORMALIZE);
  }

  async getObjectAclPolicy(_ref: AssetObjectRef): Promise<ObjectAclPolicy | null> {
    // Phase 2 ships without ACL persistence on SPE — Synozur-WebBase has
    // no rows that exercise non-public ACLs today, so the simpler path
    // is to leave this null and revisit when a real consumer needs it.
    // Keep the method signature intact so the interface stays uniform.
    return null;
  }

  async setObjectAclPolicy(
    _ref: AssetObjectRef,
    _policy: ObjectAclPolicy,
  ): Promise<void> {
    // No-op for the same reason as getObjectAclPolicy.
  }

  async deleteObject(ref: AssetObjectRef): Promise<void> {
    await speFileStorage.deleteFile(asSpeFileId(ref), ref.speContainerId);
  }

  async uploadObject(opts: UploadObjectOptions): Promise<AssetObjectRef> {
    const stored = await speFileStorage.storeFile({
      body: opts.body,
      filename: opts.filename,
      contentType: opts.contentType,
      documentType: opts.documentType,
      ownerId: opts.ownerId,
      uploadedByUserId: opts.uploadedByUserId,
    });
    return speRef(stored.itemId, stored.containerId);
  }
}
