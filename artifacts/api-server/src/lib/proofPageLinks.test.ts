/**
 * Content-integrity test: hardcoded case-study links in the synozur SPA
 * must point at real, published case studies.
 *
 * The proof page (artifacts/synozur/src/pages/proof.tsx) hardcodes
 * case-study slugs in its copy, and a few other files hardcode literal
 * /case-studies/<slug> hrefs. Those are not CMS-driven, so nothing stops
 * them drifting when a case study's slug changes — this test does.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:proof-links
 *
 * Hits the real DATABASE_URL (dev DB) because the DB is the source of
 * truth for public /case-studies/:slug URLs (the SPA detail page fetches
 * the API first and only falls back to its static dataset on 404).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isNull, and, inArray } from "drizzle-orm";
import { db, pool, caseStudiesTable } from "@workspace/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const synozurSrc = path.resolve(here, "../../../synozur/src");

/** Recursively list .ts/.tsx files under a directory. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** slug charset: word chars, digits, '&', ASCII '-' and U+2011 non-breaking hyphen. */
const SLUG_CHARS = "[\\w&\\-\\u2011]+";

/** Extract hardcoded case-study slugs with their source location. */
function collectHardcodedSlugs(): Map<string, string[]> {
  const bySlug = new Map<string, string[]>();
  const add = (slug: string, where: string) => {
    const list = bySlug.get(slug) ?? [];
    list.push(where);
    bySlug.set(slug, list);
  };

  // 1. proof.tsx `slug: "..."` fields (ProofCase / quote / spotlight entries).
  const proofPath = path.join(synozurSrc, "pages/proof.tsx");
  const proofSource = fs.readFileSync(proofPath, "utf8");
  for (const m of proofSource.matchAll(new RegExp(`slug: "(${SLUG_CHARS})"`, "gu"))) {
    add(m[1], "pages/proof.tsx");
  }

  // 2. Literal /case-studies/<slug> hrefs anywhere in the SPA source
  //    (template-literal hrefs like `/case-studies/${x}` don't match).
  for (const file of listSourceFiles(synozurSrc)) {
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(new RegExp(`["'\`]/case-studies/(${SLUG_CHARS})["'\`]`, "gu"))) {
      add(m[1], path.relative(synozurSrc, file));
    }
  }
  return bySlug;
}

test("hardcoded case-study links resolve to published case studies", async () => {
  const bySlug = collectHardcodedSlugs();
  assert.ok(
    bySlug.size >= 10,
    `Expected to find at least 10 hardcoded case-study slugs (proof page has ~13); found ${bySlug.size}. ` +
      "If the proof page was refactored, update the extraction in this test.",
  );

  const slugs = [...bySlug.keys()];
  const rows = await db
    .select({ slug: caseStudiesTable.slug, publishedAt: caseStudiesTable.publishedAt })
    .from(caseStudiesTable)
    .where(and(inArray(caseStudiesTable.slug, slugs), isNull(caseStudiesTable.deletedAt)));
  const found = new Map(rows.map((r) => [r.slug, r]));

  const problems: string[] = [];
  for (const [slug, locations] of bySlug) {
    const row = found.get(slug);
    if (!row) {
      problems.push(`MISSING: "${slug}" (linked from ${locations.join(", ")}) — no live case study has this slug`);
    } else if (!row.publishedAt) {
      problems.push(`UNPUBLISHED: "${slug}" (linked from ${locations.join(", ")}) — case study exists but is not published`);
    }
  }

  assert.deepEqual(
    problems,
    [],
    `Hardcoded case-study links are broken:\n  ${problems.join("\n  ")}\n` +
      "Fix the slug(s) in the listed file(s) to match the live case study slugs.",
  );
});

test.after(async () => {
  await pool.end();
});
