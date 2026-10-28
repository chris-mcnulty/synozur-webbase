import assert from "node:assert/strict";
import test from "node:test";
import { isLandingPageLibraryEligible } from "./landingPageLibraryVisibility";

const now = new Date("2026-10-08T12:00:00Z");
const page = { featured: false, libraryListed: true, active: true, status: "published" };

test("a Library-listed page does not need homepage featuring", () => {
  assert.equal(isLandingPageLibraryEligible(page, now), true);
  assert.equal(page.featured, false);
});

test("existing featured pages remain eligible without the new flag", () => {
  assert.equal(isLandingPageLibraryEligible({ ...page, featured: true, libraryListed: false }, now), true);
  assert.equal(isLandingPageLibraryEligible({ featured: true, active: true, status: "published" }, now), true);
});

test("draft, disabled, deleted, unlisted and out-of-window pages stay hidden", () => {
  for (const override of [
    { status: "draft" }, { status: "archived" }, { active: false },
    { deletedAt: now }, { libraryListed: false },
    { publishedAt: new Date("2026-10-09T00:00:00Z") },
    { unpublishedAt: now },
  ]) assert.equal(isLandingPageLibraryEligible({ ...page, ...override }, now), false);
});
