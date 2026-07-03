/**
 * Static-page OG registry ↔ client `<Meta>` drift guard (#342, #344).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:og-static-pages
 *
 * Hand-coded (non-DB) SPA pages declare their social-preview copy in TWO
 * places:
 *   1. Each page's client-side `<Meta>` in `artifacts/synozur/src/pages/*`
 *      — what humans (and JS-executing browsers) see.
 *   2. The server-side `STATIC_PAGE_OG` registry in `ogResolver.ts` — what
 *      social crawlers (LinkedIn / Slack / Teams / Twitter), which never run
 *      JS, see.
 *
 * If someone edits a page's title/description/image but forgets to update the
 * registry (or vice versa), crawlers silently unfurl stale/generic copy with
 * no error. This test does three things so drift fails loudly before shipping:
 *
 *   A. DRIFT — for every REGISTERED page, parse its `<Meta>` straight from
 *      source and assert the registry matches the title/description/image the
 *      client would render.
 *   B. REGISTRY COMPLETENESS — assert STATIC_PAGE_OG contains exactly the
 *      REGISTERED paths (no orphan entries, no missing ones).
 *   C. PAGE COVERAGE — scan every `*.tsx` under the pages dir that renders a
 *      `<Meta>` and assert each file is either REGISTERED or explicitly
 *      EXCLUDED with a reason. A newly added hand-coded page therefore can't
 *      silently ship generic previews — the build fails until it's triaged.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative, sep } from "node:path";
import { STATIC_PAGE_OG, SITE_NAME, DEFAULT_IMAGE_PATH } from "./ogResolver";

const HERE = dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/lib → artifacts/synozur/src/pages
const PAGES_DIR = resolve(HERE, "../../../synozur/src/pages");

/**
 * Single-segment, hand-coded, indexable pages whose `<Meta>` copy must be
 * mirrored into STATIC_PAGE_OG. Keyed by registry path → the page source file
 * (relative to PAGES_DIR) that owns its `<Meta>`. Two paths may share one file
 * (e.g. `/` and `/home-b` both render HomeB).
 */
const REGISTERED: ReadonlyArray<{ path: string; file: string }> = [
  { path: "/", file: "home-b.tsx" },
  { path: "/home-b", file: "home-b.tsx" },
  { path: "/sprint", file: "sprint.tsx" },
  { path: "/proof", file: "proof.tsx" },
  { path: "/fit", file: "fit.tsx" },
  { path: "/book", file: "booking.tsx" },
  { path: "/about", file: "about.tsx" },
  { path: "/clients", file: "clients.tsx" },
  { path: "/partners", file: "partners.tsx" },
  { path: "/contact", file: "contact.tsx" },
  { path: "/team", file: "team.tsx" },
  { path: "/privacy", file: "privacy.tsx" },
  { path: "/terms", file: "terms.tsx" },
  { path: "/trust", file: "trust.tsx" },
  { path: "/join", file: "join.tsx" },
  { path: "/careers", file: "careers.tsx" },
  { path: "/polaris", file: "polaris.tsx" },
  { path: "/events", file: "events.tsx" },
  // Multi-segment hand-coded routes now covered by STATIC_PAGE_OG.
  // The drift check reads the FIRST <Meta> in each file, which is the
  // hard-coded DefaultOverview / form meta (not the DB-driven branches).
  { path: "/services-overview/default", file: "services-overview.tsx" },
  { path: "/start/brief", file: "start-brief.tsx" },
];

/**
 * Every other page (relative to PAGES_DIR) that renders a `<Meta>` but is
 * deliberately NOT in STATIC_PAGE_OG, with the reason. The PAGE COVERAGE test
 * asserts this set plus REGISTERED files exactly covers the pages that render
 * `<Meta>` — so adding a new page forces a decision here.
 *
 * Categories:
 *   - db-list     — single-segment list page whose seoTitle/seoDescription/
 *                   ogImage come from the `content_parent_pages` table (the
 *                   "List page copy" admin screen).  `resolveOgData` reads
 *                   the row in its `!slug` path (after the landing-pages check)
 *                   so social crawlers see the admin-configured copy rather than
 *                   the generic site default.  These pages are NOT registered in
 *                   STATIC_PAGE_OG because their OG copy is DB-driven, not
 *                   hard-coded.
 *   - db-detail   — two-segment DB detail page already covered by the
 *                   `resolveOgData` switch (insights/services/solutions/…).
 *   - db-landing  — DB-driven landing page covered by the landing-pages path.
 *   - dynamic     — title/description computed at runtime (query, category,
 *                   DB copy) — no single static value to register.
 *   - multiseg    — hard-coded but multi-segment; the single-segment
 *                   STATIC_PAGE_OG path can't address it.
 *   - noindex     — auth/utility/error pages that render `noindex`; not meant
 *                   to be shared/unfurled.
 *   - parked      — inactive variant that canonicalizes elsewhere.
 */
const EXCLUDED: Readonly<Record<string, string>> = {
  // db-list (content_parent_pages / "List page copy" — resolved server-side
  // by resolveOgData's !slug → content_parent_pages branch, not STATIC_PAGE_OG)
  "applications.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=applications), resolved by resolveOgData",
  "case-studies.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=case-studies), resolved by resolveOgData",
  "insights.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=insights), resolved by resolveOgData",
  "items.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=items), resolved by resolveOgData",
  "library.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=library), resolved by resolveOgData",
  "models.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=models), resolved by resolveOgData",
  "videos.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=videos), resolved by resolveOgData",
  "webinars.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=webinars), resolved by resolveOgData",
  "white-papers.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=white-papers), resolved by resolveOgData",
  "workshops.tsx": "db-list: seoTitle/seoDescription/ogImage from content_parent_pages row (slug=workshops), resolved by resolveOgData",

  // db-detail (two-segment, resolveOgData switch covers it)
  "application-detail.tsx": "db-detail: /applications/:slug via resolver switch",
  "case-study-detail.tsx": "db-detail: /case-studies/:slug via resolver switch",
  "event-detail.tsx": "db-detail: /events/:slug via resolver switch",
  "insight-detail.tsx": "db-detail: /insights/:slug via resolver switch",
  "library-detail.tsx": "db-detail: /library/:slug via resolver switch",
  "model-detail.tsx": "db-detail: /models/:slug via resolver switch",
  "polaris-episode-detail.tsx": "db-detail: /polaris/:slug via resolver switch",
  "service-detail.tsx": "db-detail: /services/:slug via resolver switch",
  "solution-detail.tsx": "db-detail: /solutions/:slug via resolver switch",
  "team-detail.tsx": "db-detail: /team/:slug via resolver switch",
  "video-detail.tsx": "db-detail: /videos/:slug via resolver switch",
  "webinar-detail.tsx": "db-detail: /webinars/:slug via resolver switch",
  "white-paper-detail.tsx": "db-detail: /white-papers/:slug via resolver switch",
  "workshop-detail.tsx": "db-detail: /workshops/:slug via resolver switch",

  // db-landing
  "landing-page.tsx": "db-landing: /:slug via resolver landing-pages path",

  // dynamic (runtime-computed <Meta>, no single static value)
  "faq.tsx": "dynamic: title/description computed per category/item",
  "search.tsx": "dynamic: query-based title + noindex",
  "start.tsx": "dynamic: copy from list-page-copy",
  "start-detail.tsx": "dynamic: DB-driven start flow detail",
  "insights/ask.tsx": "dynamic: Q&A page, runtime-computed <Meta>",
  "event-schedule.tsx": "dynamic: /events/:slug/schedule (multi-segment, DB)",

  // multiseg (hard-coded but not addressable by single-segment registry)
  // services-overview.tsx — now REGISTERED at /services-overview/default
  // start-brief.tsx — now REGISTERED at /start/brief
  "careers-detail.tsx": "multiseg: /careers/:slug (DB job data)",
  "careers-apply.tsx": "multiseg: /careers/:slug/apply form",
  "careers-applied.tsx": "multiseg: careers application confirmation",

  // noindex (auth / utility / error / embed — not meant to unfurl)
  "careers-embed-jobs.tsx": "noindex: iframe embed of open positions",
  "careers-embed-job.tsx": "noindex: iframe embed of a single position",
  "sign-in.tsx": "noindex: auth page",
  "sign-up.tsx": "noindex: auth page",
  "verify-email.tsx": "noindex: auth page",
  "pending-approval.tsx": "noindex: auth page",
  "forgot-password.tsx": "noindex: auth page",
  "reset-password.tsx": "noindex: auth page",
  "not-found.tsx": "noindex: 404 page (pageType not-found)",
  "gone.tsx": "noindex: 410 page (pageType not-found)",

  // parked
  "home.tsx": "parked: /home-a variant, canonicalizes to /",
};

interface MetaProps {
  title: string;
  description: string;
  /** null when the page renders no `image=` prop (falls back to the default). */
  image: string | null;
  rawTitle: boolean;
}

/**
 * Extract the props of the first `<Meta ... />` element in a page's source.
 * The registered pages use plain double-quoted string literals for
 * title/description (and optionally image) plus a bare `rawTitle` boolean, so a
 * targeted regex is enough — no JSX parser required. Throws if the block or a
 * required attr is missing so a refactor that changes the shape surfaces as a
 * failure, not a silent skip.
 */
function extractMetaProps(source: string, file: string): MetaProps {
  const block = source.match(/<Meta\b([\s\S]*?)\/>/);
  assert.ok(block, `No self-closing <Meta .../> element found in ${file}`);
  const body = block[1];

  const attr = (name: string, required: boolean): string | null => {
    const m = body.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{"([^"]*)"\\})`));
    if (!m) {
      assert.ok(
        !required,
        `<Meta> in ${file} is missing a "${name}" string attribute`,
      );
      return null;
    }
    return m[1] ?? m[2] ?? "";
  };

  return {
    title: attr("title", true) as string,
    description: attr("description", true) as string,
    image: attr("image", false),
    rawTitle: /\brawTitle\b/.test(body),
  };
}

/**
 * Reproduce the client's title composition for a single-segment page. Pages
 * that render `rawTitle` use their title verbatim; all others get the
 * " | {SITE_NAME}" suffix (the `PAGE_TYPES` fallback path — no page-specific
 * `seoDefaultTitleTemplate`, matching what the server resolver emits).
 */
function expectedTitle(meta: MetaProps): string {
  return meta.rawTitle ? meta.title : `${meta.title} | ${SITE_NAME}`;
}

for (const { path, file } of REGISTERED) {
  test(`STATIC_PAGE_OG["${path}"] matches ${file} <Meta>`, () => {
    const entry = STATIC_PAGE_OG[path];
    assert.ok(entry, `STATIC_PAGE_OG has no entry for ${path}`);

    const source = readFileSync(resolve(PAGES_DIR, file), "utf8");
    const meta = extractMetaProps(source, file);

    assert.equal(
      entry.title,
      expectedTitle(meta),
      `Title drift for ${path}: registry vs ${file} <Meta>`,
    );
    assert.equal(
      entry.description,
      meta.description,
      `Description drift for ${path}: registry vs ${file} <Meta>`,
    );
    // Pages with no `image=` prop fall back to the site default OG image, so
    // that's what the registry must carry for the crawler.
    assert.equal(
      entry.image,
      meta.image ?? DEFAULT_IMAGE_PATH,
      `Image drift for ${path}: registry vs ${file} <Meta>`,
    );
  });
}

test("STATIC_PAGE_OG contains exactly the REGISTERED paths", () => {
  const registryPaths = Object.keys(STATIC_PAGE_OG).sort();
  const registeredPaths = [...new Set(REGISTERED.map((r) => r.path))].sort();
  assert.deepEqual(
    registryPaths,
    registeredPaths,
    "STATIC_PAGE_OG gained/lost a path without a matching REGISTERED entry — " +
      "add the page to REGISTERED (and its <Meta> drift check) in this test.",
  );
});

/** All `*.tsx` under PAGES_DIR that render a `<Meta>`, relative to PAGES_DIR. */
function metaBearingPages(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, dirent.name);
      if (dirent.isDirectory()) {
        walk(full);
      } else if (dirent.isFile() && dirent.name.endsWith(".tsx")) {
        if (/<Meta\b/.test(readFileSync(full, "utf8"))) {
          out.push(relative(dir, full).split(sep).join("/"));
        }
      }
    }
  };
  walk(dir);
  return out;
}

test("every page rendering <Meta> is REGISTERED or EXCLUDED", () => {
  const registeredFiles = new Set(REGISTERED.map((r) => r.file));
  const excludedFiles = new Set(Object.keys(EXCLUDED));

  const unclassified = metaBearingPages(PAGES_DIR)
    .filter((f) => !registeredFiles.has(f) && !excludedFiles.has(f))
    .sort();

  assert.deepEqual(
    unclassified,
    [],
    "These pages render <Meta> but are neither REGISTERED nor EXCLUDED. A " +
      "hand-coded page without a STATIC_PAGE_OG entry unfurls the generic " +
      "site default to social crawlers. Add each to REGISTERED with a registry " +
      "entry, or to EXCLUDED with a reason:\n  " +
      unclassified.join("\n  "),
  );

  // Keep EXCLUDED honest: no stale entries for files that were deleted or no
  // longer render <Meta>.
  const metaFiles = new Set(metaBearingPages(PAGES_DIR));
  const staleExclusions = [...excludedFiles].filter((f) => !metaFiles.has(f)).sort();
  assert.deepEqual(
    staleExclusions,
    [],
    "These EXCLUDED entries no longer render <Meta> (deleted or refactored) — " +
      "remove them from EXCLUDED:\n  " +
      staleExclusions.join("\n  "),
  );
});
