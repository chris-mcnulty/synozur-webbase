/**
 * Unit tests for `isArtifactPath` — guards against regressing the
 * classifier the SPA server uses to decide whether to probe the API
 * for publish-status (#162 / launch-readiness L13).
 *
 * Critical regression: `/polaris/rss.xml` is the canonical podcast
 * RSS feed, aliased in api-server/src/app.ts. It must NOT be
 * classified as a Polaris episode slug — otherwise the SPA server
 * would proxy to /api/seo/route-status, get back `not_found`, and
 * serve a 404 SPA shell instead of the feed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isArtifactPath, ARTIFACT_SECTIONS } from "./artifactPath.mjs";

test("classifies canonical artifact slugs as artifact paths", () => {
  assert.equal(isArtifactPath("/insights/launching-our-podcast"), true);
  assert.equal(isArtifactPath("/case-studies/acme-co"), true);
  assert.equal(isArtifactPath("/services/ai-strategy"), true);
  assert.equal(isArtifactPath("/solutions/copilot"), true);
  assert.equal(isArtifactPath("/applications/north-star"), true);
  assert.equal(isArtifactPath("/models/maturity"), true);
  assert.equal(isArtifactPath("/workshops/kickoff"), true);
  assert.equal(isArtifactPath("/white-papers/governance"), true);
  assert.equal(isArtifactPath("/polaris/episode-one"), true);
  assert.equal(isArtifactPath("/events/2026-keynote"), true);
});

test("excludes file-like second segments (regression: /polaris/rss.xml)", () => {
  // The blocking regression we fix: this MUST be excluded so the
  // RSS alias in api-server keeps serving the feed.
  assert.equal(isArtifactPath("/polaris/rss.xml"), false);
  assert.equal(isArtifactPath("/insights/rss.xml"), false);
  assert.equal(isArtifactPath("/insights/feed.json"), false);
  assert.equal(isArtifactPath("/events/calendar.ics"), false);
  assert.equal(isArtifactPath("/case-studies/sitemap.xml"), false);
});

test("excludes root and single-segment paths", () => {
  assert.equal(isArtifactPath("/"), false);
  assert.equal(isArtifactPath("/insights"), false);
  assert.equal(isArtifactPath("/insights/"), false);
  assert.equal(isArtifactPath("/polaris"), false);
});

test("excludes non-artifact sections", () => {
  assert.equal(isArtifactPath("/about/team"), false);
  assert.equal(isArtifactPath("/admin/users"), false);
  assert.equal(isArtifactPath("/api/health"), false);
  assert.equal(isArtifactPath("/sign-in"), false);
});

test("ARTIFACT_SECTIONS pins the expected union", () => {
  assert.deepEqual(
    [...ARTIFACT_SECTIONS].sort(),
    [
      "applications",
      "case-studies",
      "events",
      "insights",
      "models",
      "polaris",
      "services",
      "solutions",
      "white-papers",
      "workshops",
    ],
  );
});
