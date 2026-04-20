import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  servicesTable,
  solutionsTable,
  serviceMethodologiesTable,
  solutionCapabilitiesTable,
  mediaTable,
} from "@workspace/db";
import { parseCsvAsObjects } from "../lib/csv";
import { ObjectStorageService } from "../lib/objectStorage";
import { toSlug } from "../lib/slug";

const objectStorage = new ObjectStorageService();

const ASSETS_DIR = resolve(process.cwd(), "../../attached_assets");
const FILES = {
  services: "Services_1776707139247.csv",
  solutions: "Solutions_1776707139246.csv",
  methodologies: "Service+Methodologies_1776707139245.csv",
  capabilities: "Solution+Capabilities_1776707139244.csv",
};

/**
 * Parse a Wix media URL like:
 *   wix:image://v1/6d6954_<hash>~mv2.png/Original_Filename.png#originWidth=250&originHeight=250
 * → { httpUrl: "https://static.wixstatic.com/media/6d6954_<hash>~mv2.png", filename, width, height, mime }
 */
function parseWixIcon(raw: string): {
  httpUrl: string;
  filename: string;
  width: number | null;
  height: number | null;
  mime: string | null;
} | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("wix:image://v1/")) return null;
  const withoutScheme = trimmed.slice("wix:image://v1/".length);
  const [path, hash = ""] = withoutScheme.split("#");
  const [storageName, originalNameRaw] = path.split("/");
  if (!storageName) return null;
  const filename = originalNameRaw || storageName;
  const params = new URLSearchParams(hash);
  const w = Number(params.get("originWidth"));
  const h = Number(params.get("originHeight"));
  let mime: string | null = null;
  const ext = storageName.split(".").pop()?.toLowerCase();
  if (ext === "png") mime = "image/png";
  else if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
  else if (ext === "webp") mime = "image/webp";
  else if (ext === "svg") mime = "image/svg+xml";
  return {
    httpUrl: `https://static.wixstatic.com/media/${storageName}`,
    filename,
    width: Number.isFinite(w) && w > 0 ? w : null,
    height: Number.isFinite(h) && h > 0 ? h : null,
    mime,
  };
}

/** Cache by Wix storage name so identical icons share a single media row. */
const iconCache = new Map<string, string>(); // storageName -> media.id

async function ingestIcon(rawIconUrl: string | undefined | null): Promise<string | null> {
  if (!rawIconUrl) return null;
  const parsed = parseWixIcon(rawIconUrl);
  if (!parsed) return null;
  const cacheKey = parsed.httpUrl;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  // Look for an existing media row keyed by altText sentinel "wix:<storageName>".
  const sentinel = `wix:${cacheKey}`;
  const existing = await db.query.mediaTable.findFirst({
    where: eq(mediaTable.altText, sentinel),
  });
  if (existing) {
    iconCache.set(cacheKey, existing.id);
    return existing.id;
  }

  // Download.
  let buf: Buffer;
  try {
    const resp = await fetch(parsed.httpUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.warn(`  icon download failed (${resp.status}): ${parsed.httpUrl}`);
      return null;
    }
    buf = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.warn(`  icon fetch error for ${parsed.httpUrl}:`, err);
    return null;
  }

  // Upload to object storage via presigned URL.
  let objectPath: string;
  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const putResp = await fetch(uploadURL, {
      method: "PUT",
      headers: parsed.mime ? { "Content-Type": parsed.mime } : {},
      body: buf,
    });
    if (!putResp.ok) {
      console.warn(`  upload failed (${putResp.status}) for ${parsed.httpUrl}`);
      return null;
    }
    objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
  } catch (err) {
    console.warn(`  upload error for ${parsed.httpUrl}:`, err);
    return null;
  }

  const publicUrl = `/api/storage${objectPath}`;
  const [row] = await db
    .insert(mediaTable)
    .values({
      storageKey: objectPath,
      publicUrl,
      mime: parsed.mime,
      width: parsed.width,
      height: parsed.height,
      byteSize: buf.byteLength,
      altText: sentinel,
    })
    .returning();
  iconCache.set(cacheKey, row.id);
  return row.id;
}

function deriveSlugFromUrl(urlField: string | undefined, fallbackTitle: string): string {
  if (urlField) {
    const last = urlField.split("/").filter(Boolean).pop();
    if (last) return toSlug(last);
  }
  return toSlug(fallbackTitle);
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: string | undefined): boolean {
  return (v ?? "").trim().toLowerCase() === "true";
}

async function ingestServices(): Promise<Map<string, string>> {
  const text = readFileSync(resolve(ASSETS_DIR, FILES.services), "utf8");
  const rows = parseCsvAsObjects(text);
  const sourceToId = new Map<string, string>();

  for (const r of rows) {
    const sourceId = r["ID"];
    if (!sourceId) continue;
    const title = r["Title"] || "Untitled Service";
    const slug = deriveSlugFromUrl(r["Services (Item)"], title);
    const iconId = await ingestIcon(r["Icon"]);
    const values = {
      slug,
      title,
      displayOrder: num(r["Display Order"]),
      iconId,
      parentServiceId: null,
      servicePath: r["Services (Item)"] || null,
      overviewPath: r["Services Overview"] || null,
      buttonText: r["Button Text"] || null,
      heroTextHtml: r["Hero Text"] || null,
      secondaryTitle: r["Secondary Title"] || null,
      secondaryTextHtml: r["Secondary Text"] || null,
      tertiaryTitle: r["Tertiary Title"] || null,
      tertiaryTextHtml: r["Tertiary Text"] || null,
      blurbHtml: r["Blurb"] || null,
      blogCategory: r["Primary Blog Category Text"] || null,
      sourceId,
      active: true,
      updatedAt: new Date(),
    };
    const existing = await db.query.servicesTable.findFirst({
      where: eq(servicesTable.sourceId, sourceId),
    });
    if (existing) {
      await db
        .update(servicesTable)
        .set(values)
        .where(eq(servicesTable.id, existing.id));
      sourceToId.set(sourceId, existing.id);
    } else {
      const [inserted] = await db
        .insert(servicesTable)
        .values(values)
        .returning({ id: servicesTable.id });
      sourceToId.set(sourceId, inserted.id);
    }
  }
  console.log(`  services: ${sourceToId.size}`);
  return sourceToId;
}

async function ingestSolutions(
  serviceIdMap: Map<string, string>,
): Promise<Map<string, string>> {
  const text = readFileSync(resolve(ASSETS_DIR, FILES.solutions), "utf8");
  const rows = parseCsvAsObjects(text);
  const sourceToId = new Map<string, string>();

  for (const r of rows) {
    const sourceId = r["ID"];
    if (!sourceId) continue;
    const title = r["Title"] || "Untitled Solution";
    const slug = deriveSlugFromUrl(r["Solutions (Item)"], title);
    const iconId = await ingestIcon(r["Icon"]);
    const parentSourceId = r["Parent Service"] || null;
    const parentServiceId = parentSourceId
      ? serviceIdMap.get(parentSourceId) ?? null
      : null;
    const values = {
      slug,
      title,
      displayOrder: num(r["Display Order"]),
      parentServiceId,
      iconId,
      routePath: r["Solutions (Item)"] || null,
      buttonText: r["Button Text"] || null,
      heroTextHtml: r["Hero Text"] || null,
      secondaryTitle: r["Secondary Title"] || null,
      secondaryTextHtml: r["Secondary Text"] || null,
      ourApproachTitle: r["Our Approach Title"] || null,
      ourApproachTextHtml: r["Our Approach Text"] || null,
      blurbHtml: r["Blurb"] || null,
      blurbCopy: r["Blurb Copy"] || null,
      heroTextColor: r["Hero Text Color"] || null,
      tagsText: r["Tags"] || null,
      blogCategory: r["Blog Category"] || null,
      blogTag: r["Blog Tag"] || null,
      primaryBlogCategoryFilter: r["Primary Blog Category Filter"] || null,
      buttonUrl: r["Button URL"] || null,
      sourceId,
      active: true,
      updatedAt: new Date(),
    };
    const existing = await db.query.solutionsTable.findFirst({
      where: eq(solutionsTable.sourceId, sourceId),
    });
    if (existing) {
      await db
        .update(solutionsTable)
        .set(values)
        .where(eq(solutionsTable.id, existing.id));
      sourceToId.set(sourceId, existing.id);
    } else {
      const [inserted] = await db
        .insert(solutionsTable)
        .values(values)
        .returning({ id: solutionsTable.id });
      sourceToId.set(sourceId, inserted.id);
    }
  }
  console.log(`  solutions: ${sourceToId.size}`);
  return sourceToId;
}

async function ensurePlaceholderService(
  sourceId: string,
  serviceIdMap: Map<string, string>,
): Promise<string> {
  const existingMapped = serviceIdMap.get(sourceId);
  if (existingMapped) return existingMapped;
  const found = await db.query.servicesTable.findFirst({
    where: eq(servicesTable.sourceId, sourceId),
  });
  if (found) {
    serviceIdMap.set(sourceId, found.id);
    return found.id;
  }
  const slug = `service-${sourceId.slice(0, 8)}`;
  const [row] = await db
    .insert(servicesTable)
    .values({
      slug,
      title: `Service ${sourceId.slice(0, 8)}`,
      sourceId,
      active: false, // placeholder; admin can promote/rename later
    })
    .returning({ id: servicesTable.id });
  serviceIdMap.set(sourceId, row.id);
  return row.id;
}

async function ingestMethodologies(serviceIdMap: Map<string, string>): Promise<number> {
  const text = readFileSync(resolve(ASSETS_DIR, FILES.methodologies), "utf8");
  const rows = parseCsvAsObjects(text);
  let count = 0;
  for (const r of rows) {
    const sourceId = r["ID"];
    if (!sourceId) continue;
    const parentSourceId = r["Service Offering"];
    if (!parentSourceId) {
      console.warn(`  methodology ${sourceId} skipped: no parent`);
      continue;
    }
    const serviceId = await ensurePlaceholderService(parentSourceId, serviceIdMap);
    const iconId = await ingestIcon(r["Icon"]);
    const values = {
      serviceId,
      title: r["Title"] || "Untitled",
      displayOrder: num(r["Order"]) ?? 0,
      iconId,
      bodyHtml: r["Rich Text"] || null,
      hidden: bool(r["Hide"]),
      sourceId,
      updatedAt: new Date(),
    };
    const existing = await db.query.serviceMethodologiesTable.findFirst({
      where: eq(serviceMethodologiesTable.sourceId, sourceId),
    });
    if (existing) {
      await db
        .update(serviceMethodologiesTable)
        .set(values)
        .where(eq(serviceMethodologiesTable.id, existing.id));
    } else {
      await db.insert(serviceMethodologiesTable).values(values);
    }
    count++;
  }
  console.log(`  methodologies: ${count}`);
  return count;
}

async function ingestCapabilities(solutionIdMap: Map<string, string>): Promise<number> {
  const text = readFileSync(resolve(ASSETS_DIR, FILES.capabilities), "utf8");
  const rows = parseCsvAsObjects(text);
  let count = 0;
  for (const r of rows) {
    const sourceId = r["ID"];
    if (!sourceId) continue;
    const parentSourceId = r["Solution"];
    const solutionId = parentSourceId ? solutionIdMap.get(parentSourceId) : undefined;
    if (!solutionId) {
      console.warn(`  capability ${sourceId} skipped: parent solution ${parentSourceId} not found`);
      continue;
    }
    const iconId = await ingestIcon(r["Icon"]);
    const values = {
      solutionId,
      title: r["Title"] || "Untitled",
      displayOrder: num(r["Order"]) ?? 0,
      iconId,
      bodyHtml: r["Rich Text"] || null,
      hidden: bool(r["Hide"]),
      sourceId,
      updatedAt: new Date(),
    };
    const existing = await db.query.solutionCapabilitiesTable.findFirst({
      where: eq(solutionCapabilitiesTable.sourceId, sourceId),
    });
    if (existing) {
      await db
        .update(solutionCapabilitiesTable)
        .set(values)
        .where(eq(solutionCapabilitiesTable.id, existing.id));
    } else {
      await db.insert(solutionCapabilitiesTable).values(values);
    }
    count++;
  }
  console.log(`  capabilities: ${count}`);
  return count;
}

export async function runIngest(): Promise<void> {
  console.log("Ingesting services hierarchy...");
  const services = await ingestServices();
  const solutions = await ingestSolutions(services);
  await ingestMethodologies(services);
  await ingestCapabilities(solutions);
  console.log("Done.");
}

const isMain = (() => {
  try {
    const entry = process.argv[1] && new URL(`file://${process.argv[1]}`).href;
    return entry === import.meta.url;
  } catch {
    return false;
  }
})();

if (isMain) {
  runIngest()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      try {
        await pool.end();
      } catch {
        // ignore
      }
      process.exit(1);
    });
}
