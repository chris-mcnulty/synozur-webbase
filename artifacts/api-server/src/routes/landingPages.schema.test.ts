/**
 * Unit test for the landing-page block schema contract.
 *
 * The block payload is stored as JSONB and trusted by the public renderer
 * (`block.cards.map(...)`, `block.items.map(...)`, etc.). A malformed write
 * would crash a public URL on every visit, so the Create / Update / Import
 * routes validate every block against a `z.discriminatedUnion` before
 * persistence. This test pins that contract.
 *
 * No DB / Express boot — pure schema validation, so it's cheap to run on
 * every commit.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:landing-pages-schema
 */

import test from "node:test";
import assert from "node:assert/strict";

import { BlockSchema } from "./landingPagesSchema";

test("accepts a well-formed hero block", () => {
  const parsed = BlockSchema.safeParse({
    type: "hero",
    title: "Headline",
  });
  assert.equal(parsed.success, true);
});

test("accepts a card grid with an empty cards array", () => {
  // An editor adding a new card grid block lands here before any cards
  // exist; the renderer handles `cards.length === 0` gracefully, so the
  // schema must allow it.
  const parsed = BlockSchema.safeParse({
    type: "cardGrid",
    cards: [],
  });
  assert.equal(parsed.success, true);
});

test("rejects a card grid block without a cards array", () => {
  // Regression: previously the schema used `.passthrough()`, so a payload
  // missing `cards` would persist and then crash the renderer at
  // `block.cards.map(...)`. The discriminated union catches it here.
  const parsed = BlockSchema.safeParse({
    type: "cardGrid",
  });
  assert.equal(parsed.success, false);
});

test("rejects a card grid card without a title", () => {
  const parsed = BlockSchema.safeParse({
    type: "cardGrid",
    cards: [{ description: "no title" }],
  });
  assert.equal(parsed.success, false);
});

test("accepts a CTA with multiple buttons", () => {
  const parsed = BlockSchema.safeParse({
    type: "cta",
    heading: "Talk to us",
    buttons: [
      { label: "Contact", href: "/contact", variant: "primary" },
      { label: "Learn more", href: "https://example.com" },
    ],
  });
  assert.equal(parsed.success, true);
});

test("rejects a CTA button missing href", () => {
  const parsed = BlockSchema.safeParse({
    type: "cta",
    heading: "Talk to us",
    buttons: [{ label: "Contact" }],
  });
  assert.equal(parsed.success, false);
});

test("rejects an unknown block type", () => {
  const parsed = BlockSchema.safeParse({
    type: "carousel",
    items: [],
  });
  assert.equal(parsed.success, false);
});

test("rejects a richText block without bodyHtml", () => {
  const parsed = BlockSchema.safeParse({
    type: "richText",
    heading: "Section",
  });
  assert.equal(parsed.success, false);
});

test("accepts an FAQ with question/answer pairs", () => {
  const parsed = BlockSchema.safeParse({
    type: "faq",
    heading: "Common questions",
    items: [
      { q: "Why?", a: "Because." },
      { q: "How?", a: "Like this." },
    ],
  });
  assert.equal(parsed.success, true);
});

test("rejects an FAQ item missing the answer", () => {
  const parsed = BlockSchema.safeParse({
    type: "faq",
    items: [{ q: "Why?" }],
  });
  assert.equal(parsed.success, false);
});

test("accepts an image block with just a url", () => {
  const parsed = BlockSchema.safeParse({
    type: "image",
    url: "https://cdn.example.com/hero.png",
  });
  assert.equal(parsed.success, true);
});

test("rejects an image block without a url", () => {
  const parsed = BlockSchema.safeParse({
    type: "image",
    alt: "no url",
  });
  assert.equal(parsed.success, false);
});
