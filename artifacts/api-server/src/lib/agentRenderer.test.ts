/**
 * Pure-function tests for the agent renderer (#337). Uses the repo's node:test
 * convention (see socialBotRenderer.test.ts) — vitest is not a dependency here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCmsHtml, renderAgentDocument } from "./agentRenderer";
import { SITE_NAME, type OgData } from "./ogResolver";

test("sanitizeCmsHtml returns empty string for nullish input", () => {
  assert.equal(sanitizeCmsHtml(null), "");
  assert.equal(sanitizeCmsHtml(undefined), "");
  assert.equal(sanitizeCmsHtml(""), "");
});

test("sanitizeCmsHtml strips <script> blocks", () => {
  const out = sanitizeCmsHtml("<p>hi</p><script>alert('x')</script><p>bye</p>");
  assert.ok(!/<script/i.test(out));
  assert.ok(!out.includes("alert"));
  assert.ok(out.includes("<p>hi</p>"));
  assert.ok(out.includes("<p>bye</p>"));
});

test("sanitizeCmsHtml strips <style> blocks", () => {
  const out = sanitizeCmsHtml("<style>.x{color:red}</style><p>hi</p>");
  assert.ok(!/<style/i.test(out));
  assert.ok(out.includes("<p>hi</p>"));
});

test("sanitizeCmsHtml strips inline event handlers and javascript: urls", () => {
  const out = sanitizeCmsHtml(
    `<a href="javascript:evil()" onclick="evil()">x</a>`,
  );
  assert.ok(!/onclick/i.test(out));
  assert.ok(!/javascript:/i.test(out));
});

test("sanitizeCmsHtml preserves benign markup", () => {
  const html = '<h2>Title</h2><p>Body with <a href="/x">link</a></p>';
  assert.equal(sanitizeCmsHtml(html), html);
});

const og: OgData = {
  title: "Example Page",
  description: "A short description.",
  image: "https://example.com/og.jpg",
  ogType: "article",
  url: "https://example.com/insights/example",
};

test("renderAgentDocument produces a complete HTML document with metadata", () => {
  const doc = renderAgentDocument(og, "<h1>Body</h1>");
  assert.match(doc, /^<!DOCTYPE html>/);
  assert.ok(doc.includes("<title>Example Page</title>"));
  assert.ok(
    doc.includes('<meta name="description" content="A short description." />'),
  );
  assert.ok(doc.includes('<meta property="og:type" content="article" />'));
  assert.ok(
    doc.includes(
      '<link rel="canonical" href="https://example.com/insights/example" />',
    ),
  );
});

test("renderAgentDocument embeds the provided main content", () => {
  const doc = renderAgentDocument(og, "<h1>Custom Body</h1>");
  assert.ok(doc.includes("<main>"));
  assert.ok(doc.includes("<h1>Custom Body</h1>"));
});

test("renderAgentDocument includes primary nav and crawl pointers", () => {
  const doc = renderAgentDocument(og, "<h1>Body</h1>");
  assert.ok(doc.includes(SITE_NAME));
  assert.ok(doc.includes(">Insights</a>"));
  assert.ok(doc.includes(">Team</a>"));
  assert.ok(doc.includes("/sitemap.xml"));
  assert.ok(doc.includes("/llms.txt"));
});

test("renderAgentDocument escapes special characters in metadata", () => {
  const doc = renderAgentDocument(
    { ...og, title: 'A & B "quoted" <tag>' },
    "<h1>x</h1>",
  );
  assert.ok(doc.includes("A &amp; B"));
  assert.ok(!doc.includes("<title>A & B"));
});
