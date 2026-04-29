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

import { randomUUID } from "crypto";
import type { ObjectAclPolicy } from "../objectAcl";
import type {
  AssetObjectRef,
  AssetStorageBackend,
  UploadObjectOptions,
} from "./types";
import { ObjectNotFoundError } from "./types";
import { speFileStorage } from "./spe/fileStorage";

const NOT_SUPPORTED_PUBLIC_PATHS =
  "SharePoint Embedded has no equivalent of PUBLIC_OBJECT_SEARCH_PATHS. " +
  "Public-object reads must go through the api-server with cached auth " +
  "(routing change pending Phase 3 cutover).";

const NOT_SUPPORTED_NORMALIZE =
  "normalizeObjectEntityPath is GCS-specific (storage.googleapis.com URL " +
  "stripping). SPE refs are identified by drive item id, not URL path.";

// SPE refs always carry `speFileId` — that's the SharePoint drive
// item id the upload route stashed on the way in. `storageKey` is
// kept as a human-recognisable `/spe/<itemId>` shape for debug
// readability; nothing parses it.
function speRef(itemId: string, containerId?: string): AssetObjectRef {
  return { storageKey: `/spe/${itemId}`, speFileId: itemId, speContainerId: containerId };
}

function asSpeFileId(ref: AssetObjectRef): string {
  if (!ref.speFileId) {
    throw new Error(
      `Ref ${JSON.stringify(ref)} has no speFileId — only the SPE backend constructs valid SPE refs and they always carry one`,
    );
  }
  return ref.speFileId;
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

  // SPE has no presigned-URL equivalent of GCS. We return a URL that
  // points back at our own api-server's `PUT /storage/uploads/spe-direct/:token`
  // route — the client uploads the file there as if it were a presigned
  // URL, the route streams the bytes through to SharePoint, and the
  // resulting drive-item id is stashed in the spe upload cache keyed by
  // the same token so that the subsequent `POST /cms/media` can populate
  // `spe_file_id` on the new media row.
  async getObjectEntityUploadURL(): Promise<string> {
    const token = randomUUID();
    return `/api/storage/uploads/spe-direct/${token}`;
  }

  // Path-shaped lookups always go through the GCS backend in
  // `ObjectStorageService` (see `objectStorage.ts`). This method is
  // here only to satisfy the AssetStorageBackend interface; nothing
  // routes into it. Throwing clearly is friendlier than silently
  // returning a synthetic ref if some future caller reaches it
  // directly.
  async getObjectEntityFile(_objectPath: string): Promise<AssetObjectRef> {
    throw new ObjectNotFoundError();
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
