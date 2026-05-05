/**
 * Regenerate the static fallback arrays in lib/synozur-nav/src/index.ts
 * from the live database so the nav lib stays in sync with admin edits
 * without manual intervention.
 *
 * Rewrites two exported constants:
 *   - STATIC_SERVICE_PILLARS  — published top-level service pillars + their solutions
 *   - STATIC_APPLICATIONS     — nav-visible published applications
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run gen-nav-statics
 *
 * Idempotent. If the DB has no rows the existing values are preserved and
 * the script exits with a non-zero code so the pipeline can catch it.
 *
 * The script is wired into scripts/post-merge.sh and runs automatically
 * on every task merge.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isNull, eq, asc, and } from "drizzle-orm";
import { db, servicesTable, solutionsTable, applicationsTable } from "@workspace/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NAV_LIB = resolve(ROOT, "lib/synozur-nav/src/index.ts");

// ---------------------------------------------------------------------------
// DB queries — only published, active, non-deleted rows
// ---------------------------------------------------------------------------

async function fetchPillars() {
  const services = await db
    .select({
      id: servicesTable.id,
      slug: servicesTable.slug,
      title: servicesTable.title,
      displayOrder: servicesTable.displayOrder,
    })
    .from(servicesTable)
    .where(
      and(
        isNull(servicesTable.parentServiceId),
        isNull(servicesTable.deletedAt),
        eq(servicesTable.active, true),
        eq(servicesTable.status, "published"),
      ),
    )
    .orderBy(asc(servicesTable.displayOrder), asc(servicesTable.title));

  const result: Array<{
    title: string;
    slug: string;
    solutions: Array<{ title: string; slug: string }>;
  }> = [];

  for (const svc of services) {
    const sols = await db
      .select({
        slug: solutionsTable.slug,
        title: solutionsTable.title,
        displayOrder: solutionsTable.displayOrder,
      })
      .from(solutionsTable)
      .where(
        and(
          eq(solutionsTable.parentServiceId, svc.id),
          isNull(solutionsTable.deletedAt),
          eq(solutionsTable.active, true),
          eq(solutionsTable.status, "published"),
        ),
      )
      .orderBy(asc(solutionsTable.displayOrder), asc(solutionsTable.title));

    result.push({
      title: svc.title,
      slug: svc.slug,
      solutions: sols
        .filter((s) => s.slug && s.title)
        .map((s) => ({ title: s.title!, slug: s.slug! })),
    });
  }

  return result;
}

async function fetchApplications() {
  const apps = await db
    .select({
      slug: applicationsTable.slug,
      name: applicationsTable.name,
      featuredRank: applicationsTable.featuredRank,
    })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.showInNav, true),
        isNull(applicationsTable.deletedAt),
        eq(applicationsTable.active, true),
        eq(applicationsTable.status, "published"),
      ),
    )
    .orderBy(asc(applicationsTable.featuredRank), asc(applicationsTable.slug));

  return apps
    .filter((a) => a.slug && a.name)
    .map((a) => ({ slug: a.slug, name: a.name }));
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function renderPillars(
  pillars: Array<{
    title: string;
    slug: string;
    solutions: Array<{ title: string; slug: string }>;
  }>,
): string {
  const items = pillars.map((p) => {
    const sols = p.solutions
      .map(
        (s) =>
          `      { title: ${JSON.stringify(s.title)}, slug: ${JSON.stringify(s.slug)} },`,
      )
      .join("\n");
    const solsBlock = sols ? `\n${sols}\n    ` : "";
    return `  {\n    title: ${JSON.stringify(p.title)},\n    slug: ${JSON.stringify(p.slug)},\n    solutions: [${solsBlock}],\n  },`;
  });
  return `export const STATIC_SERVICE_PILLARS: NavService[] = [\n${items.join("\n")}\n];`;
}

function renderApplications(apps: Array<{ slug: string; name: string }>): string {
  const items = apps
    .map(
      (a) =>
        `  { slug: ${JSON.stringify(a.slug)}, name: ${JSON.stringify(a.name)} },`,
    )
    .join("\n");
  return `export const STATIC_APPLICATIONS: NavApplication[] = [\n${items}\n];`;
}

// ---------------------------------------------------------------------------
// File rewrite helpers
// ---------------------------------------------------------------------------

/**
 * Replace the exported const block that begins with `startMarker` (e.g.
 * "export const STATIC_SERVICE_PILLARS") up to and including the closing
 * standalone `];` of its array literal.
 *
 * To avoid being tricked by `[]` in the TypeScript type annotation (e.g.
 * `NavService[]`), bracket counting is started only from the `= [` that
 * opens the actual array value — not from the marker itself.
 */
function replaceBlock(src: string, startMarker: string, replacement: string): string {
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find marker: ${startMarker}`);
  }

  // Find "= [" after the start marker to locate the array literal opening.
  const assignIdx = src.indexOf("= [", startIdx);
  if (assignIdx === -1) {
    throw new Error(`Could not find "= [" after marker: ${startMarker}`);
  }

  // The `[` of `= [` is the top-level array opener. Start scanning from
  // the character AFTER it with depth=1 so the first unmatched `]` is
  // guaranteed to be the top-level close.
  let depth = 1;
  let endIdx = -1;

  // assignIdx points to `=`; +2 skips `= ` to reach `[`; +3 skips past it.
  for (let i = assignIdx + 3; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        // This `]` closes the top-level array; consume the trailing `;`.
        let j = i + 1;
        if (src[j] === ";") j++;
        endIdx = j;
        break;
      }
    }
  }

  if (endIdx === -1) {
    throw new Error(`Could not find closing ]; for marker: ${startMarker}`);
  }

  return src.slice(0, startIdx) + replacement + src.slice(endIdx);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Reading DB…");
  const [pillars, apps] = await Promise.all([fetchPillars(), fetchApplications()]);

  if (pillars.length === 0) {
    console.error(
      "ERROR: No published service pillars found in the database. " +
        "Run ingestServices.ts first, or check DATABASE_URL. " +
        "Leaving lib/synozur-nav/src/index.ts unchanged.",
    );
    process.exit(1);
  }

  if (apps.length === 0) {
    console.error(
      "ERROR: No nav-visible published applications found in the database. " +
        "Run seedApplications.ts first, or check DATABASE_URL. " +
        "Leaving lib/synozur-nav/src/index.ts unchanged.",
    );
    process.exit(1);
  }

  console.log(`  Pillars: ${pillars.length}, Applications: ${apps.length}`);

  let src = readFileSync(NAV_LIB, "utf-8");

  src = replaceBlock(src, "export const STATIC_SERVICE_PILLARS", renderPillars(pillars));
  src = replaceBlock(src, "export const STATIC_APPLICATIONS", renderApplications(apps));

  writeFileSync(NAV_LIB, src, "utf-8");
  console.log(`Wrote ${NAV_LIB}`);

  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
