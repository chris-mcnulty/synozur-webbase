import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import { objectStorageClient } from "../lib/objectStorage";

interface SeedItem {
  file: string;
  displayName: string;
  category: "people" | "north-star";
}

// Mapping of attached_assets filenames to display names + categories.
// People = real people / human subjects (group shots and lone-figure-with-sky shots).
// North-star = cosmic / starry / nebula shots (no human subjects).
const ITEMS: SeedItem[] = [
  // People — group / multi-person shots
  { file: "AdobeStock_113472808_1776708217614.jpeg", displayName: "People — gathered team (113472808)", category: "people" },
  { file: "AdobeStock_906941431_1776708217617.jpeg", displayName: "People — collaborative group (906941431)", category: "people" },
  { file: "AdobeStock_735003621_1776708217616.jpeg", displayName: "People — leadership group (735003621)", category: "people" },
  { file: "Homepage-B_1776708217620.png", displayName: "People — homepage editorial B", category: "people" },
  // People — lone figure with sky / horizon
  { file: "AdobeStock_167081726_1776708217612.jpeg", displayName: "People — lone figure under sky (167081726)", category: "people" },
  { file: "AdobeStock_362805421_1776708217610.jpeg", displayName: "People — figure on horizon (362805421)", category: "people" },
  { file: "Homepage-Filler-A_1776708217619.png", displayName: "People — homepage filler A", category: "people" },
  // People — additional business / editorial shots (second batch)
  { file: "AdobeStock_216576334_1776708643442.jpeg", displayName: "People — business editorial (216576334)", category: "people" },
  { file: "AdobeStock_289923630_1776708643444.jpeg", displayName: "People — business editorial (289923630)", category: "people" },
  { file: "AdobeStock_491131853_1776708643445.jpeg", displayName: "People — business editorial (491131853)", category: "people" },
  { file: "AdobeStock_504114321_1776708643446.jpeg", displayName: "People — business editorial (504114321)", category: "people" },
  { file: "AdobeStock_621274472_1776708643447.jpeg", displayName: "People — business editorial (621274472)", category: "people" },
  { file: "AdobeStock_670678012_1776708643448.jpeg", displayName: "People — business editorial (670678012)", category: "people" },
  { file: "AdobeStock_844256800_1776708643449.jpeg", displayName: "People — business editorial (844256800)", category: "people" },
  { file: "AdobeStock_1216450441_1776708643450.jpeg", displayName: "People — business editorial (1216450441)", category: "people" },
  { file: "AdobeStock_1897009755_1776708643451.jpeg", displayName: "People — business editorial (1897009755)", category: "people" },
  // North-star — cosmic / starry shots
  { file: "AdobeStock_244105520_1776708217613.jpeg", displayName: "North star — cosmic field (244105520)", category: "north-star" },
  { file: "AdobeStock_1238508882_1776708217615.jpeg", displayName: "North star — starry sky (1238508882)", category: "north-star" },
  { file: "Firefly_5c02a715-05d7-48e2-91d7-99c03988b690_1776708217618.jpeg", displayName: "North star — firefly nebula", category: "north-star" },
  { file: "SwedenAurora_1776708096585.jpg", displayName: "North star — Sweden aurora", category: "north-star" },
];

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error("Invalid object path");
  return { bucketName: parts[1]!, objectName: parts.slice(2).join("/") };
}

async function uploadAsset(item: SeedItem): Promise<{ storageKey: string; size: number; mimeType: string }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcPath = resolve(here, "../../../../attached_assets", item.file);
  const buffer = readFileSync(srcPath);
  const ext = item.file.toLowerCase().endsWith(".png")
    ? "png"
    : item.file.toLowerCase().endsWith(".jpg") || item.file.toLowerCase().endsWith(".jpeg")
      ? "jpeg"
      : "bin";
  const mimeType = ext === "png" ? "image/png" : ext === "jpeg" ? "image/jpeg" : "application/octet-stream";

  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR env var not set");
  const objectId = randomUUID();
  const fullPath = `${privateDir}/uploads/${objectId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    contentType: mimeType,
    metadata: { contentType: mimeType },
  });
  return { storageKey: `/objects/uploads/${objectId}`, size: buffer.byteLength, mimeType };
}

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const item of ITEMS) {
    const existing = await db
      .select({ id: assetsTable.id })
      .from(assetsTable)
      .where(and(eq(assetsTable.originalName, item.displayName), eq(assetsTable.category, item.category)));
    if (existing.length > 0) {
      skipped++;
      console.log(`Skip (exists): ${item.displayName}`);
      continue;
    }
    const { storageKey, size, mimeType } = await uploadAsset(item);
    await db.insert(assetsTable).values({
      filename: item.displayName,
      originalName: item.displayName,
      mimeType,
      size,
      storageKey,
      category: item.category,
      uploadedBy: "seed:homepage-assets",
    });
    inserted++;
    console.log(`Inserted ${item.category}: ${item.displayName}`);
  }
  console.log(`Homepage assets seed complete. Inserted ${inserted}, skipped ${skipped}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
