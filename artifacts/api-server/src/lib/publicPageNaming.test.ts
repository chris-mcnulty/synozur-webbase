import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bookingOgTitle } from "./bookingOgTitle";

const brand = "The Synozur Alliance";
const now = new Date("2026-10-07T12:00:00Z");
const booking = {
  title: "GTM Strategy Review",
  seoTitle: null,
  startsAt: null,
  endsAt: null,
};
const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const page = (name: string) => source(`../../../synozur/src/pages/${name}.tsx`);

test("booking titles use their existing name and one brand suffix", () => {
  assert.equal(bookingOgTitle(booking, brand, now), `GTM Strategy Review | ${brand}`);
  assert.equal(
    bookingOgTitle({ ...booking, seoTitle: `Review with a partner | ${brand}` }, brand, now),
    `Review with a partner | ${brand}`,
  );
});

test("booking SEO titles override the booking name without being rewritten", () => {
  assert.equal(
    bookingOgTitle({ ...booking, seoTitle: "Strategy review" }, brand, now),
    `Strategy review | ${brand}`,
  );
});

test("future booking titles stay hidden", () => {
  assert.equal(
    bookingOgTitle({ ...booking, startsAt: new Date("2026-10-08T00:00:00Z") }, brand, now),
    null,
  );
});

test("expired booking titles stay hidden, including the end-time boundary", () => {
  assert.equal(bookingOgTitle({ ...booking, endsAt: now }, brand, now), null);
});

test("a booking is public at its start-time boundary", () => {
  assert.equal(bookingOgTitle({ ...booking, startsAt: now }, brand, now),
    `GTM Strategy Review | ${brand}`);
});

test("overview breadcrumb names change, but hero wording remains", () => {
  for (const name of ["services-overview", "service-detail", "solution-detail"]) {
    assert.doesNotMatch(page(name), /name: "Services"/);
    assert.match(page(name), /name: "Solutions"/);
  }
  assert.match(page("services-overview"), /AI-native\. Human-centered\. Built to land\./);
  assert.match(source("../../../synozur/src/components/layout/site-header-b.tsx"),
    /name: "Method",\s+href: "\/services-overview\/default"/);
});

test("the overview footer link says Solutions and retains its destination", () => {
  assert.match(source("../../../synozur/src/components/layout/site-footer-b.tsx"),
    /href="\/services-overview\/default"[\s\S]*?>\s*Solutions\s*<\/Link>/);
});

test("Privacy Policy is the document name in browser and crawler content", () => {
  assert.match(page("privacy"), /Privacy Policy/);
  assert.doesNotMatch(page("privacy"), /privacy statement/i);
  assert.doesNotMatch(source("./agentRenderer.ts"), /privacy statement/i);
});

test("Ask Synozur supplies only its leaf title to the section-aware formatter", () => {
  assert.match(page("insights/ask"), /title="Ask Synozur"/);
  assert.doesNotMatch(page("insights/ask"), /title="Ask Synozur — Insights"/);
});

test("a fully branded landing-page title is not branded a second time", () => {
  assert.match(page("landing-page"),
    /rawTitle=\{Boolean\(data\.seoTitle\?\.endsWith\(` \| \$\{SITE_NAME\}`\)\)\}/);
});

test("crawler registry includes the FAQ and Get Started identities", () => {
  const resolver = source("./ogResolver.ts");
  assert.match(resolver, /"\/faq": \{\s*title: "Frequently Asked Questions \| The Synozur Alliance"/);
  assert.match(resolver, /"\/start": \{\s*title: "Get Started \| The Synozur Alliance"/);
  assert.match(resolver, /eq\(bookingsTable\.active, true\)/);
});
