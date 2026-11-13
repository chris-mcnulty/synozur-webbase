import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bookingEmbedUrlSchema } from "./bookingEmbedUrl";

test("accepts both Microsoft cloud Bookings URL formats", () => {
  for (const path of [
    "/owa/calendar/ExampleWorkshop@contoso.com/bookings/",
    "/book/ExampleWorkshop@contoso.com/?ismsaljsauthenabled",
  ]) {
    const url = `https://bookings.cloud.microsoft${path}`;
    assert.equal(bookingEmbedUrlSchema.parse(url), url);
  }
});

test("preserves existing Bookings hosts and HTTP(S) behavior", () => {
  for (const host of [
    "outlook.office.com",
    "outlook.office365.com",
    "outlook.live.com",
    "book.ms",
  ]) {
    for (const protocol of ["https", "http"]) {
      assert.equal(
        bookingEmbedUrlSchema.safeParse(`${protocol}://${host}/bookings/`).success,
        true,
      );
    }
  }
  assert.equal(
    bookingEmbedUrlSchema.safeParse("https://BOOKINGS.CLOUD.MICROSOFT/book/example").success,
    true,
  );
});

test("rejects unrelated hosts and lookalike Microsoft domains", () => {
  for (const url of [
    "https://example.com/bookings/",
    "https://bookings.cloud.microsoft.example.com/bookings/",
    "https://fake.bookings.cloud.microsoft/bookings/",
    "https://bookings-cloud.microsoft/bookings/",
    "https://bookings.cloud.microsoft@evil.example/bookings/",
  ]) {
    assert.equal(bookingEmbedUrlSchema.safeParse(url).success, false, url);
  }
});

test("rejects unsafe schemes and malformed URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://bookings.cloud.microsoft/bookings/",
    "//bookings.cloud.microsoft/bookings/",
    "not a URL",
    "",
  ]) {
    assert.equal(bookingEmbedUrlSchema.safeParse(url).success, false, url);
  }
});

test("validation error names the newly supported host", () => {
  const result = bookingEmbedUrlSchema.safeParse("https://example.com/bookings/");
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues[0]!.message, /bookings\.cloud\.microsoft/);
  }
});

test("booking routes use the tested embed URL schema", () => {
  const source = readFileSync(new URL("../routes/bookings.ts", import.meta.url), "utf8");
  assert.match(source, /bookingEmbedUrlSchema as embedUrlSchema/);
  assert.match(source, /embedUrl:\s*embedUrlSchema/);
});

test("API iframe policy permits the exact Microsoft cloud Bookings host", () => {
  const source = readFileSync(new URL("./securityHeaders.ts", import.meta.url), "utf8");
  const frameSrc = source.match(/frameSrc:\s*\[([\s\S]*?)\]/)?.[1];
  assert.ok(frameSrc, "frameSrc policy must exist");
  assert.match(frameSrc, /"https:\/\/bookings\.cloud\.microsoft"/);
  assert.doesNotMatch(frameSrc, /https:\/\/\*\.cloud\.microsoft/);
});

test("public site iframe policy permits the exact Microsoft cloud Bookings host", () => {
  const source = readFileSync(new URL("../../../synozur/server.mjs", import.meta.url), "utf8");
  const frameSrc = source.match(/"frame-src ([^"]+)"/)?.[1];
  assert.ok(frameSrc, "frame-src policy must exist");
  assert.ok(frameSrc.split(/\s+/).includes("https://bookings.cloud.microsoft"));
  assert.ok(!frameSrc.split(/\s+/).includes("https://*.cloud.microsoft"));
});
