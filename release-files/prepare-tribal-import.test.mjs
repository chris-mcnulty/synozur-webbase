import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeTribalExport } from "./prepare-tribal-import.mjs";

const patch = JSON.parse(readFileSync(new URL("./tribal-first-nations.landing-page.json", import.meta.url), "utf8"));
const current = {
  format: "synozur-landing-page", version: 1,
  page: {
    slug: "tribal-first-nations", status: "published", active: true, featured: false, libraryListed: true,
    heroImage: "/production-selected-hero.jpg", publishedAt: "2026-10-08T20:58:10Z",
    unpublishedAt: null, serviceId: "production-service", sourceId: "production-source",
    seoCanonicalUrl: "/tribal-first-nations", title: "Old title", blocks: [],
  },
};
test("offline merge changes only approved fields and preserves production-specific values", () => {
  const result = mergeTribalExport(current, patch);
  assert.equal(result.force, undefined);
  for (const key of Object.keys(current.page).filter((key) => !(key in patch))) {
    assert.deepEqual(result.page[key], current.page[key], key);
  }
  for (const [key, value] of Object.entries(patch)) assert.deepEqual(result.page[key], value);
  assert.deepEqual(current.page.blocks, []);
});
test("wrong page or changed publication settings require review rather than overwriting", () => {
  for (const difference of [
    { slug: "other-page" }, { status: "draft" }, { active: false }, { featured: true }, { libraryListed: false },
  ]) assert.throws(() => mergeTribalExport({ ...current, page: { ...current.page, ...difference } }, patch));
});
test("patch cannot silently clear a hero, change visibility or alter the canonical destination", () => {
  for (const difference of [{ heroImage: "" }, { active: false }, { slug: "new-url" }, { seoCanonicalUrl: "/other" }]) {
    assert.throws(() => mergeTribalExport(current, { ...patch, ...difference }));
  }
});
