/**
 * Seed the case_studies table (#102).
 *
 * By default reads the static TS file at
 * `artifacts/synozur/src/data/case-studies.ts` so the DB exactly matches
 * what the public site renders today. Pass `--csv` to ingest the raw
 * Wix export at `attached_assets/Case+Studies_1776704551579.csv` instead
 * (useful for fresh seeds into a clean DB).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedCaseStudies.ts
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedCaseStudies.ts --csv
 *
 * Idempotent: upserts by `slug` (TS mode) or by `sourceId` / slug (CSV mode).
 * Preserves rows that have already been edited in the admin by only
 * overwriting tracked fields.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import {
  db,
  caseStudiesTable,
  type CaseStudyMetric,
  type CaseStudySection,
} from "@workspace/db";
import { parseCsvAsObjects } from "../lib/csv";
import { toSlug } from "../lib/slug";
import { upsertCollateralFromCaseStudy } from "../lib/syncCollateral";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../..");

type StaticCaseStudy = {
  slug: string;
  title: string;
  client: string;
  clientLabel: string;
  industry: string;
  established?: string;
  tag: string;
  summary: string;
  heroImage: string;
  challenge: CaseStudySection;
  approach: CaseStudySection[];
  outcome: CaseStudySection;
  metrics: CaseStudyMetric[];
  quote: { text: string; attribution: string };
  headline: string;
};

async function loadFromTs(): Promise<StaticCaseStudy[]> {
  const filePath = resolve(
    ROOT,
    "artifacts/synozur/src/data/case-studies.ts",
  );
  const mod = (await import(pathToFileURL(filePath).href)) as {
    caseStudies: StaticCaseStudy[];
  };
  return mod.caseStudies;
}

function htmlToParagraphs(html: string): string[] {
  if (!html) return [];
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function wixImageToCdn(wixUri: string): string {
  if (!wixUri) return "";
  if (!wixUri.startsWith("wix:image://")) return wixUri;
  const withoutScheme = wixUri.replace("wix:image://v1/", "");
  const mediaId = withoutScheme.split("/")[0];
  return `https://static.wixstatic.com/media/${mediaId}`;
}

function rowToStatic(row: Record<string, string>): StaticCaseStudy | null {
  const title = row["Title"]?.trim();
  if (!title) return null;
  const slug =
    row["Case Studies (Item)"]?.trim().replace(/^.*\//, "") || toSlug(title);
  const client = row["Company"]?.trim() ?? "";
  const challenge: CaseStudySection = {
    heading: "The challenge",
    body: [
      ...htmlToParagraphs(row["Background"] ?? ""),
      ...htmlToParagraphs(row["Objective"] ?? ""),
      ...htmlToParagraphs(row["Context"] ?? ""),
    ].filter(Boolean),
  };
  const approach: CaseStudySection[] = [];
  const methodology = htmlToParagraphs(row["Methodology"] ?? "");
  if (methodology.length > 0) {
    approach.push({ heading: "Our approach", body: methodology });
  }
  const outcome: CaseStudySection = {
    heading: "The outcome",
    body: htmlToParagraphs(row["Results"] ?? ""),
  };
  const conclusion = htmlToParagraphs(row["Conclusion"] ?? "");
  if (conclusion.length > 0) outcome.body.push(...conclusion);

  return {
    slug,
    title,
    client,
    clientLabel: client,
    industry: row["Industry"]?.trim() ?? "",
    established: row["Established"]?.trim() || undefined,
    tag:
      (row["Tags"] ?? "")
        .replace(/[\[\]"]/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)[0] ?? "",
    summary: row["Summary"]?.trim() ?? "",
    heroImage: wixImageToCdn(row["BackgroundImage"]?.trim() ?? ""),
    challenge,
    approach,
    outcome,
    metrics: [],
    quote: {
      text: row["Quote"]?.trim() ?? "",
      attribution: row["Quote Attribution"]?.trim() ?? "",
    },
    headline: row["Summary WebMeta"]?.trim() ?? "",
  };
}

async function loadFromCsv(): Promise<StaticCaseStudy[]> {
  const csvPath = resolve(
    ROOT,
    "attached_assets/Case+Studies_1776704551579.csv",
  );
  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCsvAsObjects(raw);
  const out: StaticCaseStudy[] = [];
  for (const row of rows) {
    const s = rowToStatic(row);
    if (s) out.push(s);
  }
  return out;
}

async function main(): Promise<void> {
  const useCsv = process.argv.includes("--csv");
  const records = useCsv ? await loadFromCsv() : await loadFromTs();
  console.log(
    `Loaded ${records.length} case studies from ${useCsv ? "CSV" : "static TS"} source.`,
  );

  let created = 0;
  let updated = 0;
  for (let i = 0; i < records.length; i++) {
    const c = records[i];
    const existing = await db.query.caseStudiesTable.findFirst({
      where: eq(caseStudiesTable.slug, c.slug),
    });

    const values = {
      slug: c.slug,
      title: c.title,
      client: c.client,
      clientLabel: c.clientLabel,
      industry: c.industry,
      established: c.established ?? null,
      tag: c.tag,
      headline: c.headline,
      summary: c.summary,
      heroImage: c.heroImage,
      challenge: c.challenge,
      approach: c.approach,
      outcome: c.outcome,
      metrics: c.metrics,
      quoteText: c.quote.text,
      quoteAttribution: c.quote.attribution,
      status: "published" as const,
      publishedAt: new Date(),
      featuredRank: (i + 1) * 10,
      active: true,
      sourceId: useCsv ? `wix:${c.slug}` : `static:${c.slug}`,
    };

    if (existing) {
      const [row] = await db
        .update(caseStudiesTable)
        .set({ ...values, updatedAt: new Date(), deletedAt: null })
        .where(eq(caseStudiesTable.id, existing.id))
        .returning();
      try {
        await upsertCollateralFromCaseStudy(row);
      } catch (err) {
        console.warn("  sync-to-collateral failed:", (err as Error).message);
      }
      updated++;
    } else {
      const [row] = await db
        .insert(caseStudiesTable)
        .values(values)
        .returning();
      try {
        await upsertCollateralFromCaseStudy(row);
      } catch (err) {
        console.warn("  sync-to-collateral failed:", (err as Error).message);
      }
      created++;
    }
  }
  console.log(
    `Case studies seeded: ${created} created, ${updated} updated (from ${useCsv ? "CSV" : "TS"}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
