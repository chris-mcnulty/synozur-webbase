/**
 * Seed the videos table from the Wix CSV export.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedVideos.ts
 *
 * Idempotent: upserts by sourceId (Wix row ID).
 * Extracts video URL, thumbnail, and duration from the embedded Ricos JSON.
 * Converts wix:image:// URIs to static.wixstatic.com CDN URLs.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, videosTable } from "@workspace/db";
import { parseCsvAsObjects } from "../lib/csv";
import type { VideoCategory } from "@workspace/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../..");

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

function slugFromPath(urlPath: string): string {
  // /webinars/some-slug  →  some-slug
  const parts = urlPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

interface VideoData {
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
}

function extractVideoFromRicos(json: string): VideoData {
  const fallback: VideoData = { videoUrl: "", thumbnailUrl: "", durationSeconds: null };
  if (!json) return fallback;
  try {
    const doc = JSON.parse(json) as { nodes: any[] };

    function findVideoNode(node: any): any {
      if (node.type === "VIDEO" && node.videoData) return node.videoData;
      for (const child of node.nodes ?? []) {
        const found = findVideoNode(child);
        if (found) return found;
      }
      return null;
    }

    const vd = findVideoNode({ nodes: doc.nodes });
    if (!vd) return fallback;
    return {
      videoUrl: vd.video?.src?.url ?? "",
      thumbnailUrl: vd.thumbnail?.src?.url ?? "",
      durationSeconds: typeof vd.video?.duration === "number" ? vd.video.duration : null,
    };
  } catch {
    return fallback;
  }
}

function ricosToShortText(json: string, maxLen = 300): string {
  if (!json) return "";
  try {
    const doc = JSON.parse(json) as { nodes: any[] };
    const texts: string[] = [];

    function walk(node: any) {
      if (node.type === "TEXT" && node.textData?.text) {
        texts.push(node.textData.text as string);
      }
      for (const child of node.nodes ?? []) walk(child);
    }

    for (const node of doc.nodes) walk(node);
    const raw = texts.join("").replace(/\s+/g, " ").trim();
    return raw.length > maxLen ? raw.slice(0, maxLen - 1) + "…" : raw;
  } catch {
    return "";
  }
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

function inferCategory(_row: Record<string, string>): VideoCategory {
  return "webinar";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvPath = resolve(ROOT, "attached_assets/Videos_1776733452229.csv");
  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCsvAsObjects(raw);

  console.log(`Parsed ${rows.length} rows from CSV.`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const sourceId = row["ID"]?.trim();
    if (!sourceId) { skipped++; continue; }

    const title = row["Title"]?.trim();
    if (!title) { skipped++; continue; }

    const urlPath = row["Videos"]?.trim() ?? "";
    const slug = slugFromPath(urlPath) || sourceId;

    const ricosJson = row["Full Description"] ?? "";
    const shortDescHtml = row["Short Description"] ?? "";

    const { videoUrl, thumbnailUrl, durationSeconds } = extractVideoFromRicos(ricosJson);
    const shortDescription = ricosToShortText(ricosJson);

    const wixImageUri = row["Image"] ?? "";
    const heroImage = wixImageToCdn(wixImageUri);

    const recordedDateStr = row["Date"]?.trim();
    const recordedAt = recordedDateStr ? new Date(recordedDateStr) : null;
    const publishedAt = recordedAt;

    const tags = parseTags(row["Tags"] ?? "");
    const category = inferCategory(row);

    const values = {
      slug,
      title,
      category,
      videoUrl: videoUrl || "",
      thumbnailUrl: thumbnailUrl || null,
      heroImage,
      heroImageAlt: title,
      shortDescription,
      bodyHtml: shortDescHtml || ricosJson.slice(0, 2000),
      tags,
      pillar: null,
      recordedAt,
      durationSeconds,
      status: "published" as const,
      publishedAt,
      featured: false,
      active: true,
      sourceId,
    };

    const existing = await db.query.videosTable.findFirst({
      where: eq(videosTable.sourceId, sourceId),
    });

    if (existing) {
      await db
        .update(videosTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(videosTable.id, existing.id));
      updated++;
      console.log(`  updated: ${title}`);
    } else {
      await db.insert(videosTable).values(values);
      created++;
      console.log(`  created: ${title}`);
    }
  }

  console.log(`\nVideos seeded: ${created} created, ${updated} updated, ${skipped} skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
