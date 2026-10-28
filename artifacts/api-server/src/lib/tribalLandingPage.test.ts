import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BlockSchema, type LandingPageBlockInput } from "../routes/landingPagesSchema";

const page = JSON.parse(
  readFileSync(new URL("../content/tribal-first-nations.dev.json", import.meta.url), "utf8"),
) as {
  slug: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  blocks: LandingPageBlockInput[];
};

test("tribal landing-page content satisfies the existing CMS block contract", () => {
  assert.equal(page.slug, "tribal-first-nations");
  assert.equal(page.title, "Tribal Nations & First Nations");
  assert.ok(page.seoTitle.endsWith(" | The Synozur Alliance"));
  assert.ok(page.seoDescription.length > 0 && page.seoDescription.length <= 160);
  for (const block of page.blocks) {
    assert.equal(BlockSchema.safeParse(block).success, true, block.type);
  }
  assert.equal(page.blocks[0]!.type, "hero");
  assert.equal(page.blocks.at(-1)!.type, "cta");
});

test("release CTAs preserve the corrected production booking URL and Champion System anchor", () => {
  const buttons = page.blocks.flatMap((block) => block.type === "cta" ? block.buttons : []);
  const primary = buttons.filter((button) => button.variant === "primary");
  assert.equal(primary.length, 3);
  assert.ok(primary.every((button) => button.href === "/start/tribal-nations-first-nations-workshop"));
  const secondary = buttons.find((button) => button.label === "Explore the Champion System");
  assert.equal(secondary?.href, "#one-system-capability-built-within-your-nation");
  assert.ok(page.blocks.some((block) => "heading" in block &&
    block.heading === "One system. Capability built within your Nation."));
});

test("content preserves the approved audiences, method and existing perspective", () => {
  const hero = page.blocks.find((block) => block.type === "hero");
  assert.ok(hero?.type === "hero");
  assert.match(hero.subtitle ?? "", /U\.S\. Tribal Nations and Canadian First Nations/);
  const method = page.blocks.find((block) => block.type === "cardGrid" &&
    block.heading === "From shared understanding to sustained capability.");
  assert.ok(method?.type === "cardGrid");
  assert.deepEqual(method.cards.map((card) => card.title), ["Assess", "Define", "Deliver", "Outcomes"]);
  const urls = page.blocks.flatMap((block) => block.type === "cardGrid" ? block.cards.map((card) => card.url) : []);
  assert.ok(urls.includes("https://www.synozur.com/insights/tribal-nations-ai-and-the-sovereignty-question"));
});

test("approved Champion roles and partnership offers replace the Sprint-only journey", () => {
  const roles = page.blocks.find((b) => b.type === "cardGrid" && b.heading === "Five roles that support local capability");
  assert.ok(roles?.type === "cardGrid");
  assert.deepEqual(roles.cards.map((c) => c.title), [
    "Community Vision Holder", "Relationship Steward", "Capacity Builder", "Solution Creator", "Trusted Voice",
  ]);
  const offers = page.blocks.find((b) => b.type === "cardGrid" && b.heading === "A starting point shaped around your context.");
  assert.ok(offers?.type === "cardGrid");
  assert.deepEqual(offers.cards.map((c) => c.title), [
    "Context Session + Champion Readout", "Champion Module inside the AI & North Star Sprint",
    "Aurora™", "Champion Sustain + License & Certify",
  ]);
  assert.doesNotMatch(JSON.stringify(page), /skeptics converted|investment firm|PE-backed|EBITDA|four to six|4–6-week/i);
});

test("booking is an initial conversation, with separate assessment and unique approved metadata", () => {
  const booking = JSON.parse(readFileSync(new URL("../content/tribal-context-conversation.json", import.meta.url), "utf8"));
  assert.equal(booking.title, "Tribal Nations & First Nations — Context Conversation");
  assert.match(booking.descriptionHtml, /scoped separately and is not included simply by booking/);
  assert.match(booking.descriptionHtml, /any available Synozur adviser/);
  assert.doesNotMatch(booking.descriptionHtml, /style=|class=|<script|free consultation|skeptics converted|investment firm/i);
  assert.ok(booking.seoTitle.endsWith(" | The Synozur Alliance"));
  assert.ok(booking.seoDescription.length <= 160);
  assert.equal(booking.ogImageUrl, "/og/tribal-first-nations-context-conversation.jpg");
});

test("release files exactly match approved content and never include calendar/visibility writes", () => {
  const fixture = JSON.parse(readFileSync(new URL("../content/tribal-first-nations.dev.json", import.meta.url), "utf8"));
  const { slug: _slug, ...approved } = fixture;
  const patch = JSON.parse(readFileSync(new URL("../../../../release-files/tribal-first-nations.landing-page.json", import.meta.url), "utf8"));
  assert.deepEqual(patch, approved);
  const booking = JSON.parse(readFileSync(new URL("../content/tribal-context-conversation.json", import.meta.url), "utf8"));
  const bookingPatch = JSON.parse(readFileSync(new URL("../../../../release-files/tribal-context-conversation.booking.json", import.meta.url), "utf8"));
  assert.deepEqual(bookingPatch, booking);
  for (const content of [patch, bookingPatch]) {
    for (const key of ["id", "status", "active", "heroImage", "force", "msBusinessId", "msDefaultServiceId", "embedUrl", "slug"]) {
      assert.equal(key in content, false, `unexpected protected field ${key}`);
    }
  }
});
