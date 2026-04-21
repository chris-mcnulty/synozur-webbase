/**
 * Seed the applications table (#103).
 *
 * By default reads `artifacts/synozur/src/data/applications.ts` so what's
 * on the public site today round-trips into the DB. Pass `--csv` to
 * ingest `attached_assets/Applications_1776704983084.csv` instead.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedApplications.ts
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedApplications.ts --csv
 *
 * Idempotent: upserts by `slug`. Preserves rows already edited in admin
 * by only overwriting tracked fields.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, applicationsTable } from "@workspace/db";
import { parseCsvAsObjects } from "../lib/csv";
import { toSlug } from "../lib/slug";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../..");

type StaticApplication = {
  slug: string;
  name: string;
  tagline: string;
  version?: string;
  releaseDate: string;
  websiteUrl: string;
  isActive: boolean;
  logo: string;
  screenshot: string;
  shortSummary: string;
  description: string[];
};

async function loadFromTs(): Promise<StaticApplication[]> {
  const filePath = resolve(
    ROOT,
    "artifacts/synozur/src/data/applications.ts",
  );
  const mod = (await import(pathToFileURL(filePath).href)) as {
    applications: StaticApplication[];
  };
  return mod.applications;
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

function rowToStatic(row: Record<string, string>): StaticApplication | null {
  const name = row["Application Name"]?.trim();
  if (!name) return null;
  const urlPath =
    row["Applications (Item)"]?.trim() || row["Applications (List)"]?.trim() || "";
  const slugFromPath = urlPath.replace(/^.*\//, "").trim();
  const slug = slugFromPath || toSlug(name);
  const paragraphs = htmlToParagraphs(row["Description"] ?? "");
  return {
    slug,
    name,
    tagline: row["Tagline"]?.trim() ?? "",
    version: row["Version Number"]?.trim() || undefined,
    releaseDate: row["Release Date"]?.trim() ?? "",
    websiteUrl: row["Website URL"]?.trim() ?? "",
    isActive: (row["Is Active"]?.trim() ?? "true").toLowerCase() !== "false",
    logo: wixImageToCdn(row["Application Logo"]?.trim() ?? ""),
    screenshot: wixImageToCdn(row["Screenshot"]?.trim() ?? ""),
    shortSummary: row["Description WebMeta"]?.trim() ?? paragraphs[0] ?? "",
    description: paragraphs,
  };
}

async function loadFromCsv(): Promise<StaticApplication[]> {
  const csvPath = resolve(
    ROOT,
    "attached_assets/Applications_1776704983084.csv",
  );
  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCsvAsObjects(raw);
  const out: StaticApplication[] = [];
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
    `Loaded ${records.length} applications from ${useCsv ? "CSV" : "static TS"} source.`,
  );

  let created = 0;
  let updated = 0;
  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    const existing = await db.query.applicationsTable.findFirst({
      where: eq(applicationsTable.slug, a.slug),
    });

    const values = {
      slug: a.slug,
      title: a.name,
      name: a.name,
      tagline: a.tagline,
      shortSummary: a.shortSummary,
      descriptionParagraphs: a.description,
      version: a.version ?? null,
      releaseDate: a.releaseDate || null,
      websiteUrl: a.websiteUrl,
      logo: a.logo,
      screenshot: a.screenshot,
      userGuideUrl: null,
      showInNav: true,
      status: "published" as const,
      publishedAt: new Date(),
      featuredRank: (i + 1) * 10,
      active: a.isActive,
      sourceId: useCsv ? `wix:${a.slug}` : `static:${a.slug}`,
    };

    if (existing) {
      await db
        .update(applicationsTable)
        .set({ ...values, updatedAt: new Date(), deletedAt: null })
        .where(eq(applicationsTable.id, existing.id));
      updated++;
    } else {
      await db.insert(applicationsTable).values(values);
      created++;
    }
  }
  console.log(
    `Applications seeded: ${created} created, ${updated} updated (from ${useCsv ? "CSV" : "TS"}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
