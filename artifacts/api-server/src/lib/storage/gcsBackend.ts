import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import type { ObjectAclPolicy } from "../objectAcl";
import type {
  AssetObjectRef,
  AssetStorageBackend,
  UploadObjectOptions,
} from "./types";
import { ObjectNotFoundError } from "./types";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

interface GcsObjectRef extends AssetObjectRef {
  readonly file: File;
}

function makeRef(file: File, storageKey: string): GcsObjectRef {
  return { storageKey, file };
}

function asGcsRef(ref: AssetObjectRef): GcsObjectRef {
  const candidate = ref as Partial<GcsObjectRef>;
  if (!candidate.file) {
    throw new Error("AssetObjectRef is not a GCS ref — wrong storage backend?");
  }
  return ref as GcsObjectRef;
}

export class GcsAssetStorageBackend implements AssetStorageBackend {
  readonly name = "gcs" as const;

  private getPublicObjectSearchPaths(): string[] {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).",
      );
    }
    return paths;
  }

  private getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<AssetObjectRef | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return makeRef(file, fullPath);
      }
    }
    return null;
  }

  async downloadObject(ref: AssetObjectRef, cacheTtlSec: number = 3600): Promise<Response> {
    const { file } = asGcsRef(ref);
    const [metadata] = await file.getMetadata();
    const aclPolicy = await this.getObjectAclPolicy(ref);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<AssetObjectRef> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return makeRef(objectFile, objectPath);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async getObjectAclPolicy(ref: AssetObjectRef): Promise<ObjectAclPolicy | null> {
    const { file } = asGcsRef(ref);
    const [metadata] = await file.getMetadata();
    const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
    if (!aclPolicy) {
      return null;
    }
    return JSON.parse(aclPolicy as string);
  }

  async setObjectAclPolicy(ref: AssetObjectRef, policy: ObjectAclPolicy): Promise<void> {
    const { file } = asGcsRef(ref);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Object not found: ${file.name}`);
    }
    await file.setMetadata({
      metadata: {
        [ACL_POLICY_METADATA_KEY]: JSON.stringify(policy),
      },
    });
  }

  async deleteObject(ref: AssetObjectRef): Promise<void> {
    const { file } = asGcsRef(ref);
    await file.delete({ ignoreNotFound: true });
  }

  // --- Content-type repair helpers (used by the one-time image
  // content-type backfill script) -------------------------------------
  //
  // The served content-type comes from the GCS object's own metadata
  // (see `downloadObject` above), NOT from `media.mime`. Historical
  // uploads that landed with a generic `application/octet-stream` header
  // therefore serve broken downloads/previews even when the DB row's
  // mime is correct. These three helpers let the backfill script read the
  // stored content-type, peek the leading bytes to sniff the real format,
  // and rewrite the object's content-type in place. None of them touch
  // the bytes themselves — `setObjectContentType` only patches the
  // object's metadata resource.

  /** Read the object's currently-stored content-type metadata. */
  async getObjectContentType(ref: AssetObjectRef): Promise<string | undefined> {
    const { file } = asGcsRef(ref);
    const [metadata] = await file.getMetadata();
    return (metadata.contentType as string | undefined) ?? undefined;
  }

  /** Read the first `n` bytes of the object without downloading the rest. */
  async peekObjectHeader(ref: AssetObjectRef, n: number): Promise<Buffer> {
    const { file } = asGcsRef(ref);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = file.createReadStream({ start: 0, end: n - 1 });
      stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    return Buffer.concat(chunks);
  }

  /** Rewrite the object's stored content-type metadata (bytes untouched). */
  async setObjectContentType(
    ref: AssetObjectRef,
    contentType: string,
  ): Promise<void> {
    const { file } = asGcsRef(ref);
    await file.setMetadata({ contentType });
  }

  async uploadObject(opts: UploadObjectOptions): Promise<AssetObjectRef> {
    // Build the same `/objects/<uuid>` storageKey shape that the
    // presigned-URL upload path produces, so downstream serializers
    // don't have to care which path the bytes arrived through.
    const objectId = randomUUID();
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(opts.body, {
      contentType: opts.contentType,
      metadata: { contentType: opts.contentType },
      resumable: opts.body.length > 5 * 1024 * 1024,
    });
    const storageKey = `/objects/${objectId}`;
    return makeRef(file, storageKey);
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1]!;
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }
  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}
