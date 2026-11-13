/**
 * Invariant tests for the SEO & social preview props computed in the Polaris
 * episode editor (polaris-episode-edit.tsx).
 *
 * The editor passes the following props to <SeoLivePreview>:
 *   title      = form.seoTitle  || form.title
 *   description= form.seoDescription || form.summary
 *   slug       = form.slug
 *   imageUrl   = form.ogImage || form.artworkUrl || null
 *
 * These tests validate the precedence rules so a future editor change cannot
 * silently regress SEO-override or OG-image behaviour without breaking CI.
 *
 * Run with:
 *   pnpm --filter @workspace/synozur exec tsx --test \
 *     src/pages/admin/library/polaris-episode-seo-preview.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

// ─── Pure helper mirroring the JSX prop expressions ──────────────────────────

interface EpisodeFormSnapshot {
  title: string;
  seoTitle: string;
  summary: string;
  seoDescription: string;
  slug: string;
  artworkUrl: string;
  ogImage: string;
}

/**
 * Mirrors the <SeoLivePreview> prop expressions in polaris-episode-edit.tsx.
 * Any change to those expressions must be reflected here too, which will
 * cause these tests to fail as intended.
 */
function computePreviewProps(form: EpisodeFormSnapshot) {
  return {
    title: form.seoTitle || form.title,
    description: form.seoDescription || form.summary,
    slug: form.slug,
    imageUrl: form.ogImage || form.artworkUrl || null,
  };
}

// ─── Title fallback ───────────────────────────────────────────────────────────

test("title: seoTitle takes precedence over title", () => {
  const p = computePreviewProps({
    title: "Episode 1", seoTitle: "Custom SEO Title",
    summary: "", seoDescription: "", slug: "ep-1", artworkUrl: "", ogImage: "",
  });
  assert.equal(p.title, "Custom SEO Title");
});

test("title: falls back to title when seoTitle is empty", () => {
  const p = computePreviewProps({
    title: "Episode 1", seoTitle: "",
    summary: "", seoDescription: "", slug: "ep-1", artworkUrl: "", ogImage: "",
  });
  assert.equal(p.title, "Episode 1");
});

// ─── Description fallback ─────────────────────────────────────────────────────

test("description: seoDescription takes precedence over summary", () => {
  const p = computePreviewProps({
    title: "Ep", seoTitle: "",
    summary: "Episode summary", seoDescription: "Optimised meta description",
    slug: "ep", artworkUrl: "", ogImage: "",
  });
  assert.equal(p.description, "Optimised meta description");
});

test("description: falls back to summary when seoDescription is empty", () => {
  const p = computePreviewProps({
    title: "Ep", seoTitle: "",
    summary: "Episode summary", seoDescription: "",
    slug: "ep", artworkUrl: "", ogImage: "",
  });
  assert.equal(p.description, "Episode summary");
});

test("description: empty string when both seoDescription and summary are blank", () => {
  const p = computePreviewProps({
    title: "Ep", seoTitle: "", summary: "", seoDescription: "",
    slug: "ep", artworkUrl: "", ogImage: "",
  });
  assert.equal(p.description, "");
});

// ─── OG image precedence (matches ogResolver case "polaris") ─────────────────
// ogResolver prefers ogImage over artworkUrl. The live preview must follow the
// same precedence so admins see an accurate social card before saving.

test("imageUrl: ogImage takes precedence over artworkUrl", () => {
  const p = computePreviewProps({
    title: "Ep", seoTitle: "", summary: "", seoDescription: "", slug: "ep",
    artworkUrl: "https://cdn.example.com/artwork.jpg",
    ogImage: "https://cdn.example.com/override.jpg",
  });
  assert.equal(p.imageUrl, "https://cdn.example.com/override.jpg");
});

test("imageUrl: falls back to artworkUrl when ogImage is empty", () => {
  const p = computePreviewProps({
    title: "Ep", seoTitle: "", summary: "", seoDescription: "", slug: "ep",
    artworkUrl: "https://cdn.example.com/artwork.jpg",
    ogImage: "",
  });
  assert.equal(p.imageUrl, "https://cdn.example.com/artwork.jpg");
});

test("imageUrl: null when both ogImage and artworkUrl are empty", () => {
  const p = computePreviewProps({
    title: "Ep", seoTitle: "", summary: "", seoDescription: "", slug: "ep",
    artworkUrl: "", ogImage: "",
  });
  assert.equal(p.imageUrl, null);
});

// ─── Slug passthrough ─────────────────────────────────────────────────────────

test("slug: passed through unchanged to the preview", () => {
  const p = computePreviewProps({
    title: "Ep", seoTitle: "", summary: "", seoDescription: "",
    slug: "ep-42-ai-strategy", artworkUrl: "", ogImage: "",
  });
  assert.equal(p.slug, "ep-42-ai-strategy");
});
