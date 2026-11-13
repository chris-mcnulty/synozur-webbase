import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { db } from "@workspace/db";
import { speFileStorage } from "./storage/spe/fileStorage";
import { AVATAR_MAX_BYTES, AvatarImageError, normalizeAvatar, storeProfileAvatar } from "./profileAvatar";

afterEach(() => mock.restoreAll());

async function photo(format: "png" | "jpeg" | "webp" = "png") {
  return sharp({ create: { width: 900, height: 600, channels: 3, background: "#8547cc" } })
    .toFormat(format).toBuffer();
}

test("JPEG, PNG and WebP photos become bounded, metadata-free WebP", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    const input = await sharp(await photo(format)).withExif({ IFD0: { Artist: "Must be removed" } }).toBuffer();
    const result = await normalizeAvatar(input);
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 512);
    assert.ok(metadata.height! <= 512);
    assert.equal(metadata.exif, undefined);
  }
});

test("rejects empty, oversized, corrupt and SVG uploads", async () => {
  for (const bytes of [
    Buffer.alloc(0), Buffer.alloc(AVATAR_MAX_BYTES + 1),
    Buffer.from("not a photo"),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'),
  ]) {
    await assert.rejects(normalizeAvatar(bytes), AvatarImageError);
  }
});

test("registers a SharePoint-only media reference without changing the user's profile", async () => {
  const store = mock.method(speFileStorage, "storeFile", async (_options: Parameters<typeof speFileStorage.storeFile>[0]) => ({
    itemId: "spe-avatar", containerId: "spe-container", size: 42, contentType: "image/webp",
  }));
  let row: Record<string, unknown> | undefined;
  mock.method(db, "insert", (() => ({
    values: async (value: Record<string, unknown>) => { row = value; },
  })) as unknown as typeof db.insert);
  const url = await storeProfileAvatar(await photo(), "test-user");
  assert.match(url, /^\/api\/storage\/objects\/uploads\/[0-9a-f-]{36}$/);
  assert.equal(row?.speFileId, "spe-avatar");
  assert.equal(row?.speContainerId, "spe-container");
  assert.equal(row?.publicUrl, url);
  assert.equal(row?.uploadedBy, "test-user");
  assert.equal(store.mock.calls[0].arguments[0].documentType, "media");
});

test("storage failure propagates without falling back to another provider", async () => {
  mock.method(speFileStorage, "storeFile", async () => { throw new Error("Microsoft unavailable"); });
  const insert = mock.method(db, "insert");
  await assert.rejects(storeProfileAvatar(await photo(), "test-user"), /Microsoft unavailable/);
  assert.equal(insert.mock.callCount(), 0);
});

test("failed media registration cleans up the just-uploaded SharePoint file", async () => {
  mock.method(speFileStorage, "storeFile", async () => ({
    itemId: "spe-avatar", containerId: "spe-container", size: 42, contentType: "image/webp",
  }));
  mock.method(db, "insert", (() => ({
    values: async () => { throw new Error("Database unavailable"); },
  })) as unknown as typeof db.insert);
  const remove = mock.method(speFileStorage, "deleteFile", async () => {});
  await assert.rejects(storeProfileAvatar(await photo(), "test-user"), /Database unavailable/);
  assert.deepEqual(remove.mock.calls[0].arguments, ["spe-avatar", "spe-container"]);
});
