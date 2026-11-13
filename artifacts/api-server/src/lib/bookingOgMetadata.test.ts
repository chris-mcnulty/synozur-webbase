import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { z } from "zod";
import { bookingEmbedUrlSchema } from "./bookingEmbedUrl";

// Exercise the actual admin contract without loading auth or Graph connections.
const source = readFileSync(new URL("../routes/bookings.ts", import.meta.url), "utf8");
const expression = source.match(/const Body = ([\s\S]*?);\n\n\/\//)?.[1];
assert.ok(expression);
const Body = vm.runInNewContext(expression, {
  z, SCOPES: ["general", "offer", "conference"],
  embedUrlSchema: bookingEmbedUrlSchema,
}) as z.ZodObject<any>;

test("booking create accepts and normalizes a specific share image", () => {
  const parsed = Body.parse({
    title: "Workshop",
    embedUrl: "https://bookings.cloud.microsoft/owa/calendar/example/bookings/",
    ogImageUrl: " /og/tribal-first-nations-workshop.jpg ",
  });
  assert.equal(parsed.ogImageUrl, "/og/tribal-first-nations-workshop.jpg");
});

test("explicit null clears a booking share image", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(Body.partial().parse({ ogImageUrl: null }))), {
    ogImageUrl: null,
  });
});

test("omitting a share image from PATCH does not introduce an overwrite", () => {
  const parsed = Body.partial().parse({ seoTitle: "Workshop title" });
  assert.equal(Object.hasOwn(parsed, "ogImageUrl"), false);
  assert.match(source, /if \(d\.ogImageUrl !== undefined\) updates\.ogImageUrl = d\.ogImageUrl \?\? null/);
});
