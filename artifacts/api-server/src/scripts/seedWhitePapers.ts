/**
 * Seed the white_papers table from the Wix CSV export.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedWhitePapers.ts
 *
 * Idempotent: upserts by sourceId (Wix row ID).
 * Converts wix:image:// URIs to static.wixstatic.com CDN URLs.
 * Converts wix:document:// URIs to usrfiles.com download URLs.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, whitePapersTable } from "@workspace/db";
import { parseCsvAsObjects } from "../lib/csv";
import type { WhitePaperDocType } from "@workspace/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../..");

// Wix owner/site ID — used to reconstruct usrfiles download URLs
const WIX_SITE_ID = "b805cef0-823c-4610-b623-a9de8636fce2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wixImageToCdn(wixUri: string): string {
  if (!wixUri || !wixUri.startsWith("wix:image://")) return wixUri ?? "";
  // wix:image://v1/{mediaId}/{filename}#originWidth=...
  const withoutScheme = wixUri.replace("wix:image://v1/", "");
  const mediaId = withoutScheme.split("/")[0];
  return `https://static.wixstatic.com/media/${mediaId}`;
}

function wixDocumentToUrl(wixUri: string): string {
  // Already a real HTTPS URL
  if (!wixUri || wixUri.startsWith("https://")) return wixUri;

  // wix:document://v1/ugd/{hash}/{UrlEncodedFilename}
  // → https://{siteId}.usrfiles.com/ugd/{hash}/{UrlEncodedFilename}
  if (wixUri.startsWith("wix:document://v1/ugd/")) {
    const path = wixUri.replace("wix:document://v1/", "");
    return `https://${WIX_SITE_ID}.usrfiles.com/${path}`;
  }
  return wixUri;
}

function slugFromPath(urlPath: string): string {
  // /items/some-slug  →  some-slug
  const parts = urlPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through
  }
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function inferDocType(typeStr: string, subtitle: string, title: string): WhitePaperDocType {
  const t = (typeStr ?? "").toUpperCase().replace(/\s+/g, "_");
  if (t === "EBOOK") return "ebook";
  if (t === "WHITEPAPER" || t === "WHITE_PAPER") return "whitepaper";
  if (t === "REFERENCE") return "guide";

  // Fall back to subtitle/title heuristics
  const combined = `${subtitle} ${title}`.toLowerCase();
  if (combined.includes("ebook")) return "ebook";
  if (combined.includes("report")) return "report";
  if (combined.includes("guide") || combined.includes("framework") || combined.includes("playbook")) return "guide";
  return "whitepaper";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvPath = resolve(ROOT, "attached_assets/White+Papers+and+eBooks_1776733452234.csv");
  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCsvAsObjects(raw);

  console.log(`Parsed ${rows.length} rows from CSV.`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const sourceId = row["ID"]?.trim();
    if (!sourceId) { skipped++; continue; }

    const title = row["Title"]?.trim();
    if (!title) { skipped++; continue; }

    const urlPath = row["White Paper"]?.trim() ?? "";
    const slug = slugFromPath(urlPath) || sourceId;

    const subtitle = row["Subtitle"]?.trim() || null;
    const bodyHtml = row["Item Page Text"] ?? "";
    const shortDescription = (row["Alt Text"] ?? "").trim();

    const wixImageUri = row["Image"] ?? "";
    const heroImage = wixImageToCdn(wixImageUri);
    const heroImageAlt = title;

    const rawDocUrl = row["Document"] ?? "";
    const documentUrl = rawDocUrl ? wixDocumentToUrl(rawDocUrl) : null;

    const externalUrl = row["External URL"]?.trim() || null;

    const typeStr = row["Type"] ?? "";
    const docType = inferDocType(typeStr, subtitle ?? "", title);

    const tags = parseTags(row["Tags"] ?? "");

    const createdDateStr = row["Created Date"]?.trim();
    const publishedAt = createdDateStr ? new Date(createdDateStr) : null;

    const activeStr = (row["Active"] ?? "true").trim().toLowerCase();
    const active = activeStr !== "false";

    // Featured: first two rows get rank 1 and 2
    const featured = i < 2;
    const featuredRank = featured ? i + 1 : null;

    const values = {
      slug,
      title,
      subtitle,
      docType,
      heroImage,
      heroImageAlt,
      shortDescription,
      bodyHtml,
      tags,
      pillar: null,
      documentUrl,
      externalUrl,
      status: "published" as const,
      publishedAt,
      featured,
      featuredRank,
      active,
      sourceId,
    };

    const existing = await db.query.whitePapersTable.findFirst({
      where: eq(whitePapersTable.sourceId, sourceId),
    });

    if (existing) {
      await db
        .update(whitePapersTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(whitePapersTable.id, existing.id));
      updated++;
      console.log(`  updated [${docType}]: ${title}`);
    } else {
      await db.insert(whitePapersTable).values(values);
      created++;
      console.log(`  created [${docType}]: ${title}`);
    }
  }

  console.log(`\nWhite papers seeded: ${created} created, ${updated} updated, ${skipped} skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
