/**
 * Unit tests for buildEventJsonLdData — the pure JSON-LD builder exported
 * from event-jsonld.tsx.
 *
 * These cover the description field rules for buildEventJsonLdData itself.
 * End-to-end coverage of the event-detail.tsx fallback chain
 * (seoDescription ?? teaser ?? description ?? null) feeding into the
 * rendered page's <script type="application/ld+json"> is provided by
 * the Playwright spec at tests/event-jsonld.spec.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/components/event-jsonld.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildEventJsonLdData, type EventJsonLdProps } from "./event-jsonld";

function baseProps(overrides: Partial<EventJsonLdProps> = {}): EventJsonLdProps {
  return {
    slug: "test-event",
    name: "Test Event",
    startDate: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

test("buildEventJsonLdData: description field equals the value passed in", () => {
  const seoDescription = "Bespoke SEO description for Google rich results.";
  const data = buildEventJsonLdData(baseProps({ description: seoDescription }));
  assert.equal(
    data.description,
    seoDescription,
    "JSON-LD description should exactly match the description prop",
  );
});

test("buildEventJsonLdData: description field is omitted when prop is null", () => {
  const data = buildEventJsonLdData(baseProps({ description: null }));
  assert.ok(
    !("description" in data),
    "JSON-LD description should be absent when description prop is null",
  );
});

test("buildEventJsonLdData: description field is omitted when prop is undefined", () => {
  const data = buildEventJsonLdData(baseProps());
  assert.ok(
    !("description" in data),
    "JSON-LD description should be absent when description prop is undefined",
  );
});

test("buildEventJsonLdData: empty string description is treated as falsy and omitted", () => {
  const data = buildEventJsonLdData(baseProps({ description: "" }));
  assert.ok(
    !("description" in data),
    "JSON-LD description should be absent when description prop is an empty string",
  );
});

test("buildEventJsonLdData: output contains required schema.org fields", () => {
  const data = buildEventJsonLdData(baseProps({ description: "SEO copy" }));
  assert.equal(data["@context"], "https://schema.org");
  assert.equal(data["@type"], "Event");
  assert.ok(typeof data.name === "string" && data.name.length > 0);
  assert.ok(typeof data.url === "string" && (data.url as string).includes("test-event"));
});
