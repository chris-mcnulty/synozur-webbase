import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bufferLooksLikeRasterImage, isAmbiguousContentType } from "./storage.js";

// Magic-byte prefixes for the raster formats the resize path supports.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = Buffer.from("GIF89a", "ascii");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const BMP = Buffer.from([0x42, 0x4d, 0x00, 0x00]);
const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);

describe("bufferLooksLikeRasterImage", () => {
  it("detects the raster formats the resize path handles", () => {
    for (const [name, buf] of Object.entries({
      JPEG,
      PNG,
      GIF,
      WEBP,
      BMP,
      TIFF_LE,
      TIFF_BE,
    })) {
      assert.equal(bufferLooksLikeRasterImage(buf), true, `${name} should sniff as image`);
    }
  });

  it("rejects non-image bytes", () => {
    assert.equal(bufferLooksLikeRasterImage(Buffer.from("not an image", "utf8")), false);
    // MP4/MOV container: `ftyp` box, NOT a still image we want to resize.
    assert.equal(
      bufferLooksLikeRasterImage(
        Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
      ),
      false,
    );
    // %PDF header.
    assert.equal(bufferLooksLikeRasterImage(Buffer.from("%PDF-1.7", "ascii")), false);
    assert.equal(bufferLooksLikeRasterImage(Buffer.alloc(0)), false);
  });
});

describe("isAmbiguousContentType", () => {
  it("treats generic/missing content-types as sniff candidates", () => {
    for (const ct of [
      "",
      "application/octet-stream",
      "APPLICATION/OCTET-STREAM",
      "application/octet-stream; charset=binary",
      "binary/octet-stream",
      "application/binary",
    ]) {
      assert.equal(isAmbiguousContentType(ct), true, `"${ct}" should be ambiguous`);
    }
  });

  it("does not treat concrete types as ambiguous", () => {
    for (const ct of ["image/png", "image/jpeg", "video/mp4", "application/pdf"]) {
      assert.equal(isAmbiguousContentType(ct), false, `"${ct}" should not be ambiguous`);
    }
  });
});
