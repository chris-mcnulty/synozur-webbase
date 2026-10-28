import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { Readable } from "node:stream";
import type { UploadObjectOptions } from "./types";

// No live database, bucket, sidecar, or Graph calls in these tests.
await mock.module("@workspace/db", {
  namedExports: {
    db: { select: () => { throw new Error("Unexpected database call"); } },
    siteSettingsTable: {},
  },
});

const speStore = mock.fn(async (_opts: unknown) => ({
  itemId: "spe-image",
  containerId: "spe-container",
}));
const speRead = mock.fn(async (_id: string, _container?: string) =>
  new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } }),
);
await mock.module("./spe/fileStorage.ts", {
  namedExports: { speFileStorage: { storeFile: speStore, getFile: speRead } },
});

const { GcsAssetStorageBackend, objectStorageClient } = await import("./gcsBackend");
const { ObjectStorageService } = await import("../objectStorage");
const { ObjectNotFoundError } = await import("./types");

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
const upload: UploadObjectOptions = {
  body: jpeg,
  contentType: "image/jpeg",
  filename: "share-image.jpg",
  documentType: "media",
  ownerId: "test-owner",
};
type StoredObject = {
  body: Buffer;
  contentType: string;
};
const objects = new Map<string, StoredObject>();
const savedPaths: string[] = [];
const saveOptions: unknown[] = [];

// Fresh handles on every bucket.file() call: persistence is keyed only by
// bucket/path, never by the File handle returned by uploadObject().
const fakeBucket = (bucket: string) => ({
  file: (name: string) => {
    const path = `${bucket}/${name}`;
    return {
      name,
      save: async (body: Buffer, opts: {
        contentType: string;
        metadata: { contentType: string };
        resumable: boolean;
      }) => {
        savedPaths.push(path);
        saveOptions.push(opts);
        objects.set(path, { body: Buffer.from(body), contentType: opts.metadata.contentType });
      },
      exists: async () => [objects.has(path)],
      getMetadata: async () => {
        const stored = objects.get(path);
        assert.ok(stored, `Missing object: ${path}`);
        return [{ contentType: stored.contentType, size: stored.body.length }];
      },
      createReadStream: () => {
        const stored = objects.get(path);
        assert.ok(stored, `Missing object: ${path}`);
        return Readable.from([stored.body]);
      },
    };
  },
});

beforeEach(() => {
  // Test-only values; no configured storage or credentials are used.
  process.env.PRIVATE_OBJECT_DIR = "/storage-test-bucket/private";
  objects.clear();
  savedPaths.length = 0;
  saveOptions.length = 0;
  speStore.mock.resetCalls();
  speRead.mock.resetCalls();
});
mock.method(
  objectStorageClient,
  "bucket",
  fakeBucket as unknown as typeof objectStorageClient.bucket,
);

test("server-uploaded JPEG reloads from its persisted key with bytes and metadata intact", async () => {
  const writer = new GcsAssetStorageBackend();
  // Discard the original File handle and keep only the serializable key.
  const storageKey = (await writer.uploadObject(upload)).storageKey;
  const reader = new GcsAssetStorageBackend();
  const reloaded = await reader.getObjectEntityFile(storageKey);
  const response = await reader.downloadObject(reloaded);

  assert.match(storageKey, /^\/objects\/uploads\/[0-9a-f-]{36}$/);
  assert.equal(savedPaths[0], `storage-test-bucket/private/${storageKey.slice("/objects/".length)}`);
  assert.equal(reloaded.storageKey, storageKey);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Content-Length"), String(jpeg.length));
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=3600");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  assert.deepEqual(saveOptions[0], {
    contentType: "image/jpeg",
    metadata: { contentType: "image/jpeg" },
    resumable: false,
  });
});

test("presigned-upload URL normalization still resolves uploads/<id>", async () => {
  objects.set("storage-test-bucket/private/uploads/presigned-image", {
    body: jpeg,
    contentType: "image/jpeg",
  });
  const backend = new GcsAssetStorageBackend();
  const key = backend.normalizeObjectEntityPath(
    "https://storage.googleapis.com/storage-test-bucket/private/uploads/presigned-image?signature=test",
  );
  assert.equal(key, "/objects/uploads/presigned-image");
  const response = await backend.downloadObject(await backend.getObjectEntityFile(key));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
});

test("existing root-level keys still resolve and missing objects still reject", async () => {
  objects.set("storage-test-bucket/private/legacy-image", {
    body: jpeg,
    contentType: "image/jpeg",
  });
  const backend = new GcsAssetStorageBackend();
  const response = await backend.downloadObject(
    await backend.getObjectEntityFile("/objects/legacy-image"),
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  await assert.rejects(backend.getObjectEntityFile("/objects/missing"), ObjectNotFoundError);
});

test("service reloads a GCS upload even when SPE is active for new writes", async () => {
  const key = (await new ObjectStorageService("gcs").uploadObject(upload)).storageKey;
  const reader = new ObjectStorageService("spe");
  const response = await reader.downloadObject(await reader.getObjectEntityFile(key));
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  assert.equal(speStore.mock.callCount(), 0);
  assert.equal(speRead.mock.callCount(), 0);
});

test("SPE uploads and persisted SPE refs still dispatch through SPE", async () => {
  const uploaded = await new ObjectStorageService("spe").uploadObject(upload);
  assert.deepEqual(uploaded, {
    storageKey: "/spe/spe-image",
    speFileId: "spe-image",
    speContainerId: "spe-container",
  });
  assert.deepEqual(speStore.mock.calls[0]?.arguments[0], {
    ...upload,
    uploadedByUserId: undefined,
  });
  const reader = new ObjectStorageService("gcs");
  const ref = reader.speRef(uploaded.storageKey, uploaded.speFileId!, uploaded.speContainerId);
  const response = await reader.downloadObject(ref);
  assert.deepEqual(speRead.mock.calls[0]?.arguments, ["spe-image", "spe-container"]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  assert.equal(savedPaths.length, 0);
});
