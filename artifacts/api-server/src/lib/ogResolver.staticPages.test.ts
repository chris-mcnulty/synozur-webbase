/**
 * Static-page OG registry ↔ client `<Meta>` drift guard (#342).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-static-pages
 *
 * The /sprint, /proof, /fit, and /book pages declare their social-preview
 * copy in TWO places:
 *   1. Each page's client-side `<Meta>` in `artifacts/synozur/src/pages/*`
 *      — what humans (and JS-executing browsers) see.
 *   2. The server-side `STATIC_PAGE_OG` registry in `ogResolver.ts` — what
 *      social crawlers (LinkedIn / Slack / Teams / Twitter), which never run
 *      JS, see.
 *
 * If someone edits a page's title/description/image but forgets to update the
 * registry (or vice versa), crawlers silently unfurl stale copy with no error.
 * This test parses each page's `<Meta>` props straight from source and asserts
 * they match the registry exactly, so any drift fails loudly before it ships.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { STATIC_PAGE_OG } from "./ogResolver";

const HERE = dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/lib → artifacts/synozur/src/pages
const PAGES_DIR = resolve(HERE, "../../../synozur/src/pages");

/** Registry path → the page source file that owns its `<Meta>`. */
const PAGE_FILES: Record<string, string> = {
  "/sprint": "sprint.tsx",
  "/proof": "proof.tsx",
  "/fit": "fit.tsx",
  "/book": "booking.tsx",
};

interface MetaProps {
  title: string;
  description: string;
  image: string;
  rawTitle: boolean;
}

/**
 * Extract the props of the first `<Meta ... />` element in a page's source.
 * The pages use plain double-quoted string literals for title/description/
 * image and a bare `rawTitle` boolean prop, so a targeted regex is enough —
 * no JSX parser required. Throws if the block or a required attr is missing so
 * a refactor that changes the shape surfaces as a test failure, not a silent
 * skip.
 */
function extractMetaProps(source: string, file: string): MetaProps {
  const block = source.match(/<Meta\b([\s\S]*?)\/>/);
  assert.ok(block, `No self-closing <Meta .../> element found in ${file}`);
  const body = block[1];

  const attr = (name: string): string => {
    const m = body.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{"([^"]*)"\\})`));
    assert.ok(m, `<Meta> in ${file} is missing a "${name}" string attribute`);
    return m[1] ?? m[2] ?? "";
  };

  return {
    title: attr("title"),
    description: attr("description"),
    image: attr("image"),
    rawTitle: /\brawTitle\b/.test(body),
  };
}

for (const [path, file] of Object.entries(PAGE_FILES)) {
  test(`STATIC_PAGE_OG["${path}"] matches ${file} <Meta>`, () => {
    const entry = STATIC_PAGE_OG[path];
    assert.ok(entry, `STATIC_PAGE_OG has no entry for ${path}`);

    const source = readFileSync(resolve(PAGES_DIR, file), "utf8");
    const meta = extractMetaProps(source, file);

    // The registry titles include the site name verbatim, matching pages that
    // opt out of the site-name suffix via `rawTitle`. If a page ever drops
    // rawTitle, the client would append " | The Synozur Alliance" and the two
    // sides would diverge — so pin the invariant here.
    assert.equal(
      meta.rawTitle,
      true,
      `${file} <Meta> must set rawTitle so its title matches the registry verbatim`,
    );

    assert.equal(
      entry.title,
      meta.title,
      `Title drift for ${path}: registry vs ${file} <Meta>`,
    );
    assert.equal(
      entry.description,
      meta.description,
      `Description drift for ${path}: registry vs ${file} <Meta>`,
    );
    assert.equal(
      entry.image,
      meta.image,
      `Image drift for ${path}: registry vs ${file} <Meta>`,
    );
  });
}

test("STATIC_PAGE_OG has no entries beyond the audited pages", () => {
  const registryPaths = Object.keys(STATIC_PAGE_OG).sort();
  const auditedPaths = Object.keys(PAGE_FILES).sort();
  assert.deepEqual(
    registryPaths,
    auditedPaths,
    "STATIC_PAGE_OG gained/lost a path without a matching <Meta> drift check — " +
      "add the page's source file to PAGE_FILES in this test.",
  );
});
