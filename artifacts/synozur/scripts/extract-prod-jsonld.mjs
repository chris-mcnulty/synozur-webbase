#!/usr/bin/env node
/**
 * Headless extraction of JSON-LD from the production site.
 *
 * For each URL in the launch-readiness L19 list, render the page in chromium,
 * wait for the SPA to settle, extract every `<script type="application/ld+json">`
 * payload from the live DOM, and validate it against the required +
 * recommended properties Google publishes for each rich-result type.
 *
 * This is what we can verify automatically; the final live Google Rich Results
 * Test runs are still recorded by hand in
 * `artifacts/synozur/docs/jsonld-rich-results-verification.md`.
 *
 * Usage:
 *   node artifacts/synozur/scripts/extract-prod-jsonld.mjs \
 *     [--base https://www.synozur.com] \
 *     [--out artifacts/synozur/docs/jsonld-payload-validation.md]
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const BASE = (arg("base", "https://www.synozur.com") ?? "").replace(/\/$/, "");
const OUT = arg("out", "artifacts/synozur/docs/jsonld-payload-validation.md");

function has(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return false;
    cur = cur[p];
  }
  return cur !== undefined && cur !== null && cur !== "";
}
function check(payload, required, recommended) {
  const missingRequired = required.filter((p) => !has(payload, p));
  const missingRecommended = recommended.filter((p) => !has(payload, p));
  return { missingRequired, missingRecommended };
}

/** Find real slugs from the API endpoints so verification hits real content. */
async function discoverSlugs() {
  const team = await apiList("/api/team-members");
  const insights = await apiList("/api/insights?limit=50");
  const videos = await apiList("/api/videos?limit=50");
  const polaris = await apiList("/api/polaris/episodes?limit=50");
  const teamSlug = pickSlug(team);
  const videoSlug = pickSlug(videos);
  const polarisSlug = pickSlug(polaris);
  // Find a news-tagged insight and a non-news one if possible.
  const newsInsight =
    insights.find((i) => isNewsTagged(i)) ?? null;
  const articleInsight =
    insights.find((i) => i && i.slug && !isNewsTagged(i) && i !== newsInsight) ??
    insights[0] ??
    null;
  return {
    team: teamSlug,
    video: videoSlug,
    polaris: polarisSlug,
    news: newsInsight?.slug ?? null,
    article: articleInsight?.slug ?? null,
  };
}
function isNewsTagged(post) {
  if (!post) return false;
  const tags = [
    ...(Array.isArray(post.tags) ? post.tags : []),
    ...(Array.isArray(post.categories) ? post.categories : []),
    post.category,
  ]
    .filter(Boolean)
    .map((t) => String(typeof t === "object" ? t.slug ?? t.name ?? "" : t).toLowerCase());
  return tags.some((t) => t === "news" || t.includes("news") || t.includes("press"));
}
function pickSlug(items) {
  if (!Array.isArray(items)) return null;
  // Skip slugs that look like feed/utility paths (e.g. "rss").
  const bad = new Set(["rss", "feed", "ask", "categories", "page"]);
  const real = items.find((i) => i && i.slug && !bad.has(i.slug));
  return real?.slug ?? null;
}
async function apiList(path) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) return [];
    const j = await res.json();
    if (Array.isArray(j)) return j;
    if (Array.isArray(j.items)) return j.items;
    return [];
  } catch {
    return [];
  }
}

async function fetchJsonLd(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
  // Components inject via useEffect, give them a beat after networkidle.
  await page.waitForTimeout(500);
  const raw = await page.$$eval(
    'script[type="application/ld+json"]',
    (els) => els.map((e) => e.textContent ?? ""),
  );
  const parsed = [];
  for (const t of raw) {
    try {
      parsed.push(JSON.parse(t));
    } catch {
      parsed.push({ __parseError: true, raw: t.slice(0, 200) });
    }
  }
  return parsed;
}

function pickByType(blobs, types, requireField) {
  const want = new Set(Array.isArray(types) ? types : [types]);
  // When a discriminator field is supplied (e.g. `aggregateRating` for the
  // review snippet), prefer the blob that has it — there may be multiple
  // payloads of the same @type on the page (e.g. global Organization +
  // page-level Review wrapper).
  if (requireField) {
    const exact = blobs.find((b) => b && want.has(b["@type"]) && has(b, requireField));
    if (exact) return exact;
  }
  return blobs.find((b) => b && want.has(b["@type"]));
}

const RULES = {
  LocalBusiness: {
    required: ["@context", "@type", "name", "address.streetAddress", "address.addressLocality", "address.addressRegion", "address.postalCode", "address.addressCountry"],
    recommended: ["url", "image", "geo.latitude", "geo.longitude", "openingHoursSpecification", "sameAs"],
  },
  Person: {
    // Person isn't a Google Rich Result type today; the manual gate uses the
    // Schema Markup Validator (validator.schema.org) instead of RRT.
    required: ["@context", "@type", "name"],
    recommended: ["jobTitle", "url", "image", "sameAs", "worksFor.name"],
  },
  VideoObject: {
    required: ["@context", "@type", "name", "thumbnailUrl", "uploadDate"],
    recommended: ["description", "duration", "contentUrl", "embedUrl", "publisher.name"],
  },
  ReviewSnippet: {
    required: ["@context", "@type", "name", "aggregateRating.ratingValue", "aggregateRating.reviewCount", "aggregateRating.bestRating"],
    recommended: ["review", "url"],
  },
  Article: {
    required: ["@context", "@type", "headline"],
    recommended: ["image", "datePublished", "dateModified", "author.name", "publisher.name", "publisher.logo.url", "mainEntityOfPage.@id"],
  },
};

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: "SynozurRichResultsBot/1.0 (+rich-results-verify)" });
  const page = await context.newPage();

  const slugs = await discoverSlugs();
  const newsSlug = slugs.news;
  const articleSlug = slugs.article;

  const targets = [
    { label: "/contact — LocalBusiness", url: `${BASE}/contact`, type: "LocalBusiness", rules: "LocalBusiness", manualGate: "Google Rich Results Test" },
    slugs.team
      ? { label: `/team/${slugs.team} — Person`, url: `${BASE}/team/${slugs.team}`, type: "Person", rules: "Person", manualGate: "Schema Markup Validator (Person isn't a Google Rich Result type)" }
      : { label: "/team/<slug> — Person", url: null, skip: "no team slug discovered" },
    slugs.video
      ? { label: `/videos/${slugs.video} — VideoObject`, url: `${BASE}/videos/${slugs.video}`, type: "VideoObject", rules: "VideoObject", manualGate: "Google Rich Results Test" }
      : { label: "/videos/<slug> — VideoObject", url: null, skip: "no video slug discovered" },
    slugs.polaris
      ? { label: `/polaris/${slugs.polaris} — VideoObject`, url: `${BASE}/polaris/${slugs.polaris}`, type: "VideoObject", rules: "VideoObject", manualGate: "Google Rich Results Test" }
      : { label: "/polaris/<slug> — VideoObject", url: null, skip: "no polaris slug discovered" },
    { label: "/clients — AggregateRating + Review", url: `${BASE}/clients`, type: "Organization", rules: "ReviewSnippet", manualGate: "Google Rich Results Test" },
    newsSlug
      ? { label: `/insights/${newsSlug} — NewsArticle (news-tagged)`, url: `${BASE}/insights/${newsSlug}`, type: ["NewsArticle", "Article"], rules: "Article", manualGate: "Google Rich Results Test" }
      : { label: "/insights/<news-slug> — NewsArticle", url: null, skip: "no news-tagged insight discovered" },
    articleSlug
      ? { label: `/insights/${articleSlug} — Article (default)`, url: `${BASE}/insights/${articleSlug}`, type: "Article", rules: "Article", manualGate: "Google Rich Results Test" }
      : { label: "/insights/<slug> — Article", url: null, skip: "no insight slug discovered" },
  ];

  const lines = [];
  lines.push(`# JSON-LD payload validation against production`);
  lines.push("");
  lines.push(`Generated by \`artifacts/synozur/scripts/extract-prod-jsonld.mjs\` against \`${BASE}\` at ${new Date().toISOString()}.`);
  lines.push("");
  lines.push(`> This file is **auto-generated**. The manual Rich Results Test / Schema Markup Validator results are kept separately in \`jsonld-rich-results-verification.md\` so regenerating this file never clobbers the manual checklist.`);
  lines.push("");

  let pass = 0, warn = 0, fail = 0, skipped = 0;
  for (const t of targets) {
    if (!t.url) {
      skipped++;
      lines.push(`## SKIP — ${t.label}`);
      lines.push(`- Reason: ${t.skip}`);
      lines.push("");
      continue;
    }
    let blobs;
    try {
      blobs = await fetchJsonLd(page, t.url);
    } catch (e) {
      fail++;
      lines.push(`## FAIL — ${t.label}`);
      lines.push(`- URL: ${t.url}`);
      lines.push(`- Fetch error: ${e.message}`);
      lines.push("");
      continue;
    }
    const blob = pickByType(blobs, t.type, t.rules === "ReviewSnippet" ? "aggregateRating" : undefined);
    if (!blob) {
      fail++;
      lines.push(`## FAIL — ${t.label}`);
      lines.push(`- URL: ${t.url}`);
      lines.push(`- Expected \`@type\` ${JSON.stringify(t.type)} not found.`);
      lines.push(`- Found types: ${blobs.map((b) => (b && b["@type"]) || "?").join(", ") || "(none)"}`);
      lines.push("");
      continue;
    }
    const rule = RULES[t.rules];
    const r = check(blob, rule.required, rule.recommended);
    const status = r.missingRequired.length ? "FAIL" : r.missingRecommended.length ? "WARN" : "PASS";
    if (status === "PASS") pass++; else if (status === "WARN") warn++; else fail++;
    lines.push(`## ${status} — ${t.label}`);
    lines.push(`- URL: ${t.url}`);
    lines.push(`- Manual gate: ${t.manualGate}`);
    lines.push(`- Detected \`@type\`: ${blob["@type"]}`);
    if (r.missingRequired.length) lines.push(`- Missing required: ${r.missingRequired.join(", ")}`);
    if (r.missingRecommended.length) lines.push(`- Missing recommended: ${r.missingRecommended.join(", ")}`);
    if (status === "PASS") lines.push(`- All required and recommended fields present.`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(blob, null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push(`Summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL, ${skipped} SKIP out of ${targets.length} cases.`);

  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  writeFileSync(resolve(OUT), lines.join("\n") + "\n");
  console.log(`Wrote ${OUT}`);
  console.log(`Summary: ${pass} PASS, ${warn} WARN, ${fail} FAIL, ${skipped} SKIP out of ${targets.length} cases.`);

  await browser.close();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
