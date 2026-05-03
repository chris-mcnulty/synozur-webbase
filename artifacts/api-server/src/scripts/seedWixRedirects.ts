/**
 * Seed the `wix_redirects` table with URL patterns inherited from the
 * previous Wix site.
 *
 * Sources (applied in order):
 *   1. Wix-exported CSV (96 rows — attached_assets/URL_Redirects_Export_*.csv)
 *   2. Sitemap-analysis rules — old Wix routing patterns not in the CSV
 *   3. Group 1 rules — pages that existed on the old site but aren't
 *      being rebuilt; redirected to the nearest equivalent
 *
 * Idempotent: duplicate source paths are skipped (ON CONFLICT DO NOTHING).
 * NEVER creates a redirect FROM a path that is currently a live page on the
 * new site (see LIVE_PATHS below).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedWixRedirects.ts
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Paths that are currently live pages on the new Synozur site. We must NEVER
// install a redirect FROM any of these — it would break the live page for
// every visitor. Normalized to lowercase, no trailing slash.
// ---------------------------------------------------------------------------
const LIVE_PATHS = new Set([
  "/",
  "/about",
  "/clients",
  "/contact",
  "/events",
  "/faq",
  "/insights",
  "/join",      // explicit: /join is a live newsletter-subscribe page
  "/library",
  "/models",
  "/partners",
  "/polaris",
  "/start",
  "/team",
  "/videos",
  "/webinars",
  "/white-papers",
  "/workshops",
  "/applications",
  "/case-studies",
  "/services-overview",
  "/privacy",
  "/terms",
  "/sign-in",
  "/sign-up",
]);

// ---------------------------------------------------------------------------
// Normalise a path: lowercase, ensure leading slash, strip trailing slash.
// ---------------------------------------------------------------------------
function norm(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return (withSlash.replace(/\/+$/, "") || "/").toLowerCase();
}

// ---------------------------------------------------------------------------
// Group 1 — old pages not being rebuilt; nearest equivalent on new site.
// ---------------------------------------------------------------------------
const GROUP1: [string, string][] = [
  ["/plans-and-pricing",                            "/contact"],
  ["/microsoft-partners",                           "/partners"],
  ["/ai",                                           "/solutions/ai-strategy-and-design"],
  ["/free-consultation",                            "/contact"],
  ["/express",                                      "/contact"],
  ["/microsoft-partner-gtm-strategy-review",        "/solutions/microsoft-partner-development"],
  ["/service-page/microsoft-partner-gtm-strategy-review", "/solutions/microsoft-partner-development"],
];

// ---------------------------------------------------------------------------
// Sitemap-analysis rules — organised by routing layer.
// /join → /start is intentionally excluded: /join is a live page.
// ---------------------------------------------------------------------------
const SITEMAP: [string, string][] = [
  // Flat solution pages → /solutions/:slug
  ["/brand-messaging",          "/solutions/brand-and-messaging"],
  ["/communications",           "/solutions/communication-strategies"],
  ["/design",                   "/solutions/design-strategies"],
  ["/roadmaps",                 "/solutions/strategic-roadmaps"],
  ["/employee-effectiveness",   "/solutions/employee-effectiveness"],
  ["/employee-strategies",      "/solutions/employee-strategies"],
  ["/fractional-leadership",    "/solutions/fractional-leadership"],
  ["/delivery-project-management", "/solutions/delivery-management"],
  ["/gtm-strategy",             "/solutions/gtm-strategy-and-execution"],
  ["/company-operating-system", "/solutions/company-os"],
  ["/ai-training",              "/solutions/ai-strategy-and-design"],

  // /strategy-solutions/ → /solutions/
  ["/strategy-solutions/company-os",                    "/solutions/company-os"],
  ["/strategy-solutions/ai-strategy-and-design",        "/solutions/ai-strategy-and-design"],
  ["/strategy-solutions/gtm-strategy-and-execution",    "/solutions/gtm-strategy-and-execution"],
  ["/strategy-solutions/brand-and-messaging",           "/solutions/brand-and-messaging"],
  ["/strategy-solutions/ux-design",                     "/solutions/design-strategies"],
  ["/strategy-solutions/communication-strategies",      "/solutions/communication-strategies"],
  ["/strategy-solutions/employee-strategies",           "/solutions/employee-strategies"],
  ["/strategy-solutions/employee-experience",           "/solutions/employee-effectiveness"],
  ["/strategy-solutions/strategic-roadmaps",            "/solutions/strategic-roadmaps"],
  ["/strategy-solutions/delivery-management",           "/solutions/delivery-management"],
  ["/strategy-solutions/fractional-leadership",         "/solutions/fractional-leadership"],
  ["/strategy-solutions/microsoft-partner-development-", "/solutions/microsoft-partner-development"],

  // /service-offerings/ → /services/
  ["/service-offerings/experiences",              "/services/experiences"],
  ["/service-offerings/technology-transformation", "/services/technology-transformation"],
  ["/service-offerings/gtm-transformation",       "/services/go-to-market-transformation"],
  ["/service-offerings/strategic-transformation", "/services/strategic-transformation"],

  // /items/ (Wix library) → /library/
  ["/items/2026-ai-report",                                       "/library/2026-ai-report"],
  ["/items/upgrading-your-company-operating-system-2026",         "/library/upgrading-your-company-operating-system-2026"],
  ["/items/care-raft-prompting-industry-examples",                 "/library/care-raft-prompting-industry-examples"],
  ["/items/leading-ai-playbooks-and-strategic-analysis",          "/library/leading-ai-playbooks-and-strategic-analysis"],
  ["/items/navigating-ai-stratosphere",                           "/library/navigating-ai-stratosphere"],
  ["/items/succeeding-with-copilot",                              "/library/succeeding-with-copilot"],
  ["/items/company-operating-system-paper",                       "/library/company-operating-system-paper"],

  // Event pages
  ["/event-list",         "/events"],
  ["/event-details/partner-vibe",                  "/events/partner-vibe"],
  ["/event-details/m365-community-conference-2026", "/events/m365-community-conference-2026"],
  ["/event-details/transforming-the-digital-workplace-strategies-for-engagement-and-success",
    "/events/transforming-the-digital-workplace-strategies-for-engagement-and-success"],
  ["/event-details/fy26-forward-microsoft-partner-success-strategies",
    "/events/fy26-forward-microsoft-partner-success-strategies"],
  ["/event-details/vancouver-ai-summit",            "/events/vancouver-ai-summit"],
  ["/event-details/espc25",                         "/events/espc25"],
  ["/event-details/mastering-your-ai-rollout-success-strategies",
    "/events/mastering-your-ai-rollout-success-strategies"],
  ["/event-details/microsoft-tribal-cio-summit-2026", "/events/microsoft-tribal-cio-summit-2026"],
  ["/event-details/techcon-365-dallas",              "/events/techcon-365-dallas"],
  ["/event-details/strategy-now-with-ai-building-your-company-operating-system-for-2026-success",
    "/events/strategy-now-with-ai-building-your-company-operating-system-for-2026-success"],

  // Booking / service-page entries
  ["/service-page/ai-strategy-session",    "/contact"],
  ["/service-page/strategy-consultation",  "/contact"],
  ["/service-page/north-star-workshop",    "/workshops/company-operating-system-bootcamp-two-day-leadership-workshop"],
  ["/service-page/fractional-cxo",         "/solutions/fractional-leadership"],

  // Miscellaneous — /join → /start intentionally omitted (live page)
  ["/tools-and-tips", "/library"],
];

// ---------------------------------------------------------------------------
// CSV parsing — reads the Wix redirect export and returns [source, target]
// pairs for Active rows with non-blank Old URL and New URL.
// ---------------------------------------------------------------------------
function parseWixCsv(): [string, string][] {
  const csvPath = path.resolve(
    __dirname,
    "../../../../attached_assets/URL_Redirects_Export_1777239544495.csv",
  );

  if (!fs.existsSync(csvPath)) {
    console.warn(`CSV not found at ${csvPath} — skipping CSV import`);
    return [];
  }

  const lines = fs.readFileSync(csvPath, "utf8").split("\n");
  const results: [string, string][] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple split — the Wix export doesn't quote fields containing commas.
    const parts = line.split(",");
    // Fields: Old URL, New URL, Redirect Type, Redirect Status, Notes
    const oldUrl = (parts[0] ?? "").trim();
    const newUrl = (parts[1] ?? "").trim();
    const status = (parts[3] ?? "").trim();

    if (!oldUrl || !newUrl) continue;
    if (status.toLowerCase() !== "active") continue;

    results.push([oldUrl, newUrl]);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Upsert helper — inserts a redirect row; silently skips on conflict.
// Returns true if inserted, false if skipped.
// ---------------------------------------------------------------------------
async function upsert(
  sourcePath: string,
  targetPath: string,
  notes: string,
): Promise<boolean> {
  const src = norm(sourcePath);
  const tgt = targetPath.trim(); // preserve case on targets

  if (!src || !tgt) return false;

  // Guard: never redirect FROM a live page.
  if (LIVE_PATHS.has(src)) {
    console.log(`  SKIP (live page): ${src} → ${tgt}`);
    return false;
  }

  // Guard: never create a loop.
  if (norm(tgt) === src) {
    console.log(`  SKIP (loop):      ${src} → ${tgt}`);
    return false;
  }

  const result = await db.execute(sql`
    INSERT INTO wix_redirects (source_path, target_path, status_code, active, notes)
    VALUES (${src}, ${tgt}, 301, true, ${notes})
    ON CONFLICT (source_path) DO NOTHING
  `);

  const inserted = (result.rowCount ?? 0) > 0;
  return inserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== seedWixRedirects ===\n");

  let csvInserted = 0, csvSkipped = 0;
  const csvRows = parseWixCsv();
  console.log(`CSV: ${csvRows.length} active rows found`);
  for (const [src, tgt] of csvRows) {
    const ok = await upsert(src, tgt, "Seeded from Wix CSV export");
    if (ok) csvInserted++;
    else csvSkipped++;
  }
  console.log(`CSV: inserted=${csvInserted}, skipped/duplicate=${csvSkipped}\n`);

  let sitemapInserted = 0, sitemapSkipped = 0;
  console.log(`Sitemap-analysis: ${SITEMAP.length} rules`);
  for (const [src, tgt] of SITEMAP) {
    const ok = await upsert(src, tgt, "Seeded from sitemap analysis");
    if (ok) sitemapInserted++;
    else sitemapSkipped++;
  }
  console.log(`Sitemap-analysis: inserted=${sitemapInserted}, skipped/duplicate=${sitemapSkipped}\n`);

  let g1Inserted = 0, g1Skipped = 0;
  console.log(`Group 1: ${GROUP1.length} rules`);
  for (const [src, tgt] of GROUP1) {
    const ok = await upsert(src, tgt, "Group 1 — page not rebuilt on new site");
    if (ok) g1Inserted++;
    else g1Skipped++;
  }
  console.log(`Group 1: inserted=${g1Inserted}, skipped/duplicate=${g1Skipped}\n`);

  const total = csvInserted + sitemapInserted + g1Inserted;
  console.log(`=== Done: ${total} rows inserted total ===`);

  const rows = await db.execute(
    sql`SELECT count(*)::text AS count FROM wix_redirects`,
  );
  const countRow = rows.rows?.[0] ?? (rows as unknown as { count: string }[])[0];
  console.log(`DB total rows in wix_redirects: ${(countRow as { count: string }).count}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
