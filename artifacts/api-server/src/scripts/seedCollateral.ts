/**
 * Seed script: populates the `collateral` table.
 *
 * Two phases (both idempotent):
 *   1. Bootstrap the original 12 mock items (deduped by slug) so older code
 *      paths that reference those slugs keep working.
 *   2. Import the full collateral library from the two source CSVs in
 *      attached_assets/. Wix images are downloaded into App Storage and the
 *      resulting public URL is stored as `hero_image`. Re-running is a no-op
 *      thanks to dedupe on `source_id`.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool, collateralTable, mediaTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { parseCsvAsObjects } from "../lib/csv";
import { ObjectStorageService } from "../lib/objectStorage";
import { toSlug } from "../lib/slug";
import type {
  CollateralType,
  CollateralPillar,
} from "@workspace/db";

const objectStorage = new ObjectStorageService();
// Resolve relative to this script so the seeder works regardless of cwd:
//   <repo>/artifacts/api-server/src/scripts/seedCollateral.ts -> <repo>/attached_assets
const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../attached_assets");
const COLLATERAL_CSV = "Collateral_1776714742837.csv";
const FEED_CSV = "From+The+Feed_1776706589115.csv";

// ---------------------------------------------------------------------------
// Phase 1: legacy mock items
// ---------------------------------------------------------------------------

const MOCK_DATA = [
  {
    slug: "techcon-365-seattle",
    type: "event" as const,
    title: "TechCon 365 Seattle",
    description:
      "Join our team at TechCon 365 Seattle for sessions on Microsoft 365, Copilot, and the future of the digital workplace.",
    heroImage: "/images/home/feed/feed-1-techcon-365.jpeg",
    pillar: "technology" as const,
    tags: ["Events", "Microsoft 365", "Conference"],
    url: "https://www.synozur.com/event-details/techcon-365-seattle",
    external: true,
    publishedAt: new Date("2025-09-01"),
    featured: true,
    featuredRank: 1,
  },
  {
    slug: "polaris-strategy-unplugged-with-dr-john-hillen",
    type: "podcast" as const,
    title: "Strategy Dialogues with Dr. John Hillen",
    description:
      "An in-depth Polaris conversation with Dr. John Hillen on leadership, strategy, and navigating uncertainty.",
    heroImage: "/images/home/feed/feed-2-strategy-dialogues.jpeg",
    pillar: "strategic" as const,
    tags: ["Polaris", "Leadership", "Strategy"],
    url: "/polaris",
    external: false,
    publishedAt: new Date("2025-06-12"),
    featured: true,
    featuredRank: 2,
  },
  {
    slug: "holiday-reflections-from-synozur-a-dynamic-2024",
    type: "insight" as const,
    title: "2024 - A Dynamic Year",
    description:
      "Holiday reflections from the Synozur team on a year of transformation, growth, and what comes next.",
    heroImage: "/images/home/feed/feed-3-dynamic-2024.jpg",
    pillar: "strategic" as const,
    tags: ["Insights", "Reflections"],
    url: "/insights",
    external: false,
    publishedAt: new Date("2024-12-20"),
    featured: true,
    featuredRank: 3,
  },
  {
    slug: "transforming-your-digital-workplace-akumina",
    type: "webinar" as const,
    title: "Transform Your Digital Workplace",
    subtitle: "Co-presented with Akumina",
    description:
      "A practical webinar on how to modernize the digital workplace — from intranet strategy to employee experience platforms — without disrupting the business.",
    heroImage: "/images/home/feed/feed-4-digital-workplace.jpg",
    pillar: "technology" as const,
    tags: ["Digital Workplace", "Akumina", "Employee Experience"],
    url: "/webinars/transforming-your-digital-workplace-akumina",
    external: false,
    publishedAt: new Date("2024-11-05"),
    featured: true,
    featuredRank: 4,
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  },
  {
    slug: "energy-company-reinvents-employee-expereince-and-effectiveness",
    type: "case_study" as const,
    title: "Energizing Employee Experience",
    description:
      "How a Fortune 500 energy company partnered with Synozur to reinvent its employee experience and drive measurable effectiveness gains.",
    heroImage: "/images/home/feed/feed-5-employee-experience.jpg",
    pillar: "experiences" as const,
    tags: ["Employee Experience", "Energy", "Case Study"],
    url: "/case-studies/energy-company-reinvents-employee-expereince-and-effectiveness",
    external: false,
    publishedAt: new Date("2024-10-15"),
    featured: true,
    featuredRank: 5,
  },
  {
    slug: "transforming-management-frameworks-at-microsoft",
    type: "case_study" as const,
    title: "Transforming Marketing Management at Microsoft",
    description:
      "A look at how Synozur helped reshape management frameworks across a global marketing organization at Microsoft.",
    heroImage: "/images/home/feed/feed-6-marketing-microsoft.jpg",
    pillar: "strategic" as const,
    tags: ["Microsoft", "Marketing", "Operating Model"],
    url: "/case-studies/transforming-management-frameworks-at-microsoft",
    external: false,
    publishedAt: new Date("2024-08-22"),
    featured: true,
    featuredRank: 6,
  },
  {
    slug: "polaris-ai-predictions-2025",
    type: "podcast" as const,
    title: "AI Predictions for 2025",
    description:
      "The Polaris team unpacks the AI trends most likely to reshape the enterprise in 2025 — and what leaders should do about them now.",
    heroImage: "/images/home/feed/feed-7-ai-predictions.jpg",
    pillar: "technology" as const,
    tags: ["Polaris", "AI", "Predictions"],
    url: "/polaris",
    external: false,
    publishedAt: new Date("2025-01-08"),
    featured: true,
    featuredRank: 7,
  },
  {
    slug: "ai-readiness-white-paper",
    type: "white_paper" as const,
    title: "The AI Readiness Playbook",
    subtitle: "A practical guide for executive teams",
    description:
      "A comprehensive white paper on assessing AI readiness across data, governance, talent, and operating model — with diagnostic frameworks you can apply this quarter.",
    heroImage: "/images/home/feed/feed-7-ai-predictions.jpg",
    pillar: "technology" as const,
    tags: ["AI", "White Paper", "Readiness"],
    url: "/items/ai-readiness-white-paper",
    external: false,
    publishedAt: new Date("2025-03-04"),
    featured: false,
    downloadUrl: "https://www.synozur.com/download/ai-readiness.pdf",
  },
  {
    slug: "north-star-strategy-white-paper",
    type: "white_paper" as const,
    title: "Finding Your North Star",
    subtitle: "A framework for purpose-driven strategy",
    description:
      "How leadership teams can translate purpose into a living strategy that survives quarterly noise — with a step-by-step framework and worked examples.",
    heroImage: "/images/home/feed/feed-3-dynamic-2024.jpg",
    pillar: "strategic" as const,
    tags: ["Strategy", "Purpose", "Leadership"],
    url: "/items/north-star-strategy-white-paper",
    external: false,
    publishedAt: new Date("2025-02-11"),
    featured: false,
  },
  {
    slug: "modern-intranet-webinar",
    type: "webinar" as const,
    title: "Designing the Modern Intranet",
    description:
      "A webinar covering the patterns, governance, and content strategies behind intranets that employees actually use.",
    heroImage: "/images/home/feed/feed-4-digital-workplace.jpg",
    pillar: "experiences" as const,
    tags: ["Intranet", "Digital Workplace"],
    url: "/webinars/modern-intranet-webinar",
    external: false,
    publishedAt: new Date("2025-04-09"),
    featured: false,
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  },
  {
    slug: "orion-ai-model",
    type: "model" as const,
    title: "Orion: Strategy-to-Execution Model",
    description:
      "The Orion model maps strategy through to execution rhythms, with checkpoints and accountability artifacts at every layer.",
    heroImage: "/images/home/feed/feed-2-strategy-dialogues.jpeg",
    pillar: "strategic" as const,
    tags: ["Models", "Strategy", "Operating Model"],
    url: "/library/orion-ai-model",
    external: false,
    publishedAt: new Date("2025-01-22"),
    featured: false,
  },
  {
    slug: "ai-academy-immersive-ai-leadership-day",
    type: "training" as const,
    title: "AI Academy — Immersive AI Leadership Day",
    description:
      "A leadership session that cuts through AI hype, builds shared understanding, and identifies practical, high-impact opportunities tailored to your business.",
    heroImage: "/images/workshops/ai-academy-immersive-ai-leadership-day.jpg",
    pillar: "technology" as const,
    tags: ["Workshop", "AI", "Leadership"],
    url: "/workshops/ai-academy-immersive-ai-leadership-day",
    external: false,
    publishedAt: new Date("2025-05-01"),
    featured: false,
  },
];

async function seedMockData(): Promise<void> {
  console.log("Phase 1: Bootstrap mock collateral…");
  let inserted = 0;
  let skipped = 0;
  for (const item of MOCK_DATA) {
    const existing = await db.query.collateralTable.findFirst({
      where: eq(collateralTable.slug, item.slug),
    });
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(collateralTable).values({
      slug: item.slug,
      type: item.type,
      title: item.title,
      subtitle: (item as { subtitle?: string }).subtitle ?? null,
      description: item.description,
      heroImage: item.heroImage,
      pillar: item.pillar ?? null,
      tags: item.tags ?? [],
      url: item.url,
      external: item.external ?? false,
      publishedAt: item.publishedAt ?? null,
      featured: item.featured ?? false,
      featuredRank: item.featuredRank ?? null,
      videoUrl: (item as { videoUrl?: string }).videoUrl ?? null,
      downloadUrl: (item as { downloadUrl?: string }).downloadUrl ?? null,
      active: true,
    });
    inserted++;
  }
  console.log(`  mock: inserted ${inserted}, skipped ${skipped}`);
}

// ---------------------------------------------------------------------------
// Phase 2: CSV import
// ---------------------------------------------------------------------------

function parseWixImage(raw: string): {
  httpUrl: string;
  filename: string;
  width: number | null;
  height: number | null;
  mime: string | null;
} | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed.startsWith("wix:image://v1/")) return null;
  const withoutScheme = trimmed.slice("wix:image://v1/".length);
  const [path, hash = ""] = withoutScheme.split("#");
  const [storageName, originalNameRaw] = path.split("/");
  if (!storageName) return null;
  const filename = decodeURIComponent(originalNameRaw || storageName);
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

const imageCache = new Map<string, string>(); // wix httpUrl -> public path

async function ingestImage(rawWixUrl: string | undefined | null): Promise<string | null> {
  if (!rawWixUrl) return null;
  const parsed = parseWixImage(rawWixUrl);
  if (!parsed) return null;
  if (imageCache.has(parsed.httpUrl)) return imageCache.get(parsed.httpUrl)!;

  const sentinel = `wix:${parsed.httpUrl}`;
  const existing = await db.query.mediaTable.findFirst({
    where: eq(mediaTable.altText, sentinel),
  });
  if (existing) {
    imageCache.set(parsed.httpUrl, existing.publicUrl);
    return existing.publicUrl;
  }

  let buf: Buffer;
  try {
    const resp = await fetch(parsed.httpUrl, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      console.warn(`  image download failed (${resp.status}): ${parsed.httpUrl}`);
      return null;
    }
    buf = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.warn(`  image fetch error for ${parsed.httpUrl}:`, err);
    return null;
  }

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
  await db.insert(mediaTable).values({
    storageKey: objectPath,
    publicUrl,
    mime: parsed.mime,
    width: parsed.width,
    height: parsed.height,
    byteSize: buf.byteLength,
    altText: sentinel,
  });
  imageCache.set(parsed.httpUrl, publicUrl);
  return publicUrl;
}

const INTERNAL_URL_PREFIXES = [
  "/post/",
  "/case-studies/",
  "/webinars/",
  "/event-details/",
  "/items/",
  "/models/",
  "/applications/",
  "/ai-training",
  "/workshops/",
  "/insights/",
  "/library/",
  "/polaris",
];

function isInternalUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  return INTERNAL_URL_PREFIXES.some((p) => url.startsWith(p));
}

/**
 * Map the source URL to the corresponding internal application route.
 * Polaris podcast posts live under /polaris, Wix /post/* maps to /insights/*,
 * and /event-details/* maps to /events/*. Everything else passes through.
 */
function rewriteInternalUrl(url: string): string {
  if (!url || !url.startsWith("/")) return url;
  if (url.startsWith("/post/polaris-")) return "/polaris";
  if (url.startsWith("/post/")) return "/insights" + url.slice("/post".length);
  if (url.startsWith("/event-details/")) return "/events" + url.slice("/event-details".length);
  return url;
}

function mapTypeFromText(typeText: string, url: string): CollateralType {
  const t = typeText.toUpperCase().replace(/[^A-Z]/g, "");
  if (t === "PODCAST") return "podcast";
  if (t === "CASESTUDY") return "case_study";
  if (t === "WEBINAR") return "webinar";
  if (t === "WHITEPAPER" || t === "EBOOK") return "white_paper";
  if (t === "TRAINING") return "training";
  if (t === "INTERACTIVE" || t === "APPLICATION" || t === "MODEL") return "model";
  if (t === "REFERENCE") return "insight";
  if (t === "EVENT") return "event";
  return mapTypeFromUrl(url);
}

function mapTypeFromUrl(url: string): CollateralType {
  if (!url) return "insight";
  if (url.startsWith("/post/polaris-")) return "podcast";
  if (url.startsWith("/event-details/")) return "event";
  if (url.startsWith("/case-studies/")) return "case_study";
  if (url.startsWith("/webinars/")) return "webinar";
  if (url.startsWith("/items/")) return "white_paper";
  if (url.startsWith("/models/")) return "model";
  if (url.startsWith("/applications/")) return "model";
  if (url.startsWith("/ai-training")) return "training";
  if (url.startsWith("/post/")) return "insight";
  return "insight";
}

const TAG_PILLAR_HINTS: Array<[RegExp, CollateralPillar]> = [
  [/\bAI\b|copilot|m365|microsoft|technology/i, "technology"],
  [/strategy|leadership|operating|polaris|fcxo/i, "strategic"],
  [/employee|experience|intranet|workplace/i, "experiences"],
  [/go.?to.?market|gtm|sales|marketing/i, "gtm"],
];

function inferPillar(tags: string[], title: string): CollateralPillar | null {
  const haystack = [title, ...tags].join(" ");
  for (const [rx, pillar] of TAG_PILLAR_HINTS) {
    if (rx.test(haystack)) return pillar;
  }
  return null;
}

function parseTagsField(raw: string): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function deriveSlug(url: string, title: string): string {
  if (url) {
    const last = url.split("/").filter(Boolean).pop();
    if (last) return toSlug(last);
  }
  return toSlug(title);
}

/**
 * Strip Wix Ricos rich-text JSON down to a single short plain-text paragraph
 * suitable for a card description. Falls back to the input string on parse
 * failure or returns "" for empty input.
 */
function ricosToPlain(raw: string): string {
  if (!raw) return "";
  const t = raw.trim();
  if (!t.startsWith("{")) return t;
  try {
    const doc = JSON.parse(t) as { nodes?: RicosNode[] };
    const out: string[] = [];
    walkRicos(doc.nodes ?? [], out);
    return out.join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

interface RicosNode {
  type?: string;
  textData?: { text?: string };
  nodes?: RicosNode[];
}

function walkRicos(nodes: RicosNode[], out: string[]): void {
  for (const n of nodes) {
    if (n.textData?.text) out.push(n.textData.text);
    if (n.nodes && n.nodes.length) walkRicos(n.nodes, out);
  }
}

function stripHtml(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface UpsertInput {
  sourceId: string;
  slug: string;
  type: CollateralType;
  title: string;
  description: string;
  heroImage: string;
  pillar: CollateralPillar | null;
  tags: string[];
  url: string;
  external: boolean;
  publishedAt: Date | null;
  featured: boolean;
  featuredRank: number | null;
  active: boolean;
}

async function upsertBySourceId(input: UpsertInput): Promise<"inserted" | "updated"> {
  const existing = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.sourceId, input.sourceId),
  });
  const values = {
    slug: input.slug,
    type: input.type,
    title: input.title,
    description: input.description,
    heroImage: input.heroImage,
    pillar: input.pillar,
    tags: input.tags,
    url: input.url,
    external: input.external,
    publishedAt: input.publishedAt,
    featured: input.featured,
    featuredRank: input.featuredRank,
    active: input.active,
    sourceId: input.sourceId,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(collateralTable).set(values).where(eq(collateralTable.id, existing.id));
    return "updated";
  }
  // No row by sourceId: try to attach to a row with the same slug (e.g. mock
  // bootstrap row or the same item in the other CSV) before falling back to
  // a fresh insert. Apply the full imported payload so the row reflects the
  // CSV content; only preserve a non-empty heroImage if the import couldn't
  // download one.
  const slugMatch = await db.query.collateralTable.findFirst({
    where: eq(collateralTable.slug, input.slug),
  });
  if (slugMatch) {
    // Don't reassign source_id once it's been claimed: the two CSVs share a
    // few slugs with different IDs, so re-runs would otherwise flip the
    // source_id back and forth depending on file order.
    const stableSourceId = slugMatch.sourceId ?? input.sourceId;
    const merged = {
      ...values,
      sourceId: stableSourceId,
      heroImage: values.heroImage || slugMatch.heroImage,
      // Preserve any existing featured ranking when this CSV row doesn't set
      // one (e.g. the main collateral CSV doesn't carry feed ordering).
      featured: values.featured || slugMatch.featured,
      featuredRank: values.featured ? values.featuredRank : slugMatch.featuredRank,
    };
    await db.update(collateralTable).set(merged).where(eq(collateralTable.id, slugMatch.id));
    return "updated";
  }
  await db.insert(collateralTable).values(values);
  return "inserted";
}

async function ingestCollateralCsv(): Promise<void> {
  const text = readFileSync(resolve(ASSETS_DIR, COLLATERAL_CSV), "utf8");
  const rows = parseCsvAsObjects(text);
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const sourceId = r["ID"];
    if (!sourceId) continue;
    const title = r["Title"] || "Untitled";
    const sourceUrl = r["URL"] || "";
    const slug = deriveSlug(sourceUrl, title);
    const type = mapTypeFromText(r["Type"] || "", sourceUrl);
    const tags = parseTagsField(r["Tags"]);
    const description =
      stripHtml(r["Short Description"]) ||
      ricosToPlain(r["Description"]) ||
      "";
    const heroImage = (await ingestImage(r["Image"])) ?? "";
    const internal = isInternalUrl(sourceUrl);
    const url = internal ? rewriteInternalUrl(sourceUrl) : sourceUrl;
    const result = await upsertBySourceId({
      sourceId,
      slug,
      type,
      title,
      description,
      heroImage,
      pillar: inferPillar(tags, title),
      tags,
      url,
      external: !internal,
      publishedAt: parseDate(r["Published"]) ?? parseDate(r["Created Date"]),
      featured: false,
      featuredRank: null,
      active: (r["Active"] ?? "").toLowerCase() === "true",
    });
    if (result === "inserted") inserted++;
    else updated++;
  }
  console.log(`  collateral csv: inserted ${inserted}, updated ${updated}`);
}

async function ingestFeedCsv(): Promise<void> {
  const text = readFileSync(resolve(ASSETS_DIR, FEED_CSV), "utf8");
  const rows = parseCsvAsObjects(text);
  let inserted = 0;
  let updated = 0;
  let rank = 1;
  for (const r of rows) {
    const sourceId = r["ID"];
    if (!sourceId) continue;
    const title = r["Title"] || "Untitled";
    const sourceUrl = r["Source Link"] || "";
    const slug = deriveSlug(sourceUrl, title);
    const type = mapTypeFromUrl(sourceUrl);
    const heroImage = (await ingestImage(r["Background Image"])) ?? "";
    const description = stripHtml(r["Description"]);
    const internal = isInternalUrl(sourceUrl);
    const url = internal ? rewriteInternalUrl(sourceUrl) : sourceUrl;
    const result = await upsertBySourceId({
      sourceId,
      slug,
      type,
      title,
      description,
      heroImage,
      pillar: inferPillar([], title),
      tags: [],
      url,
      external: !internal,
      publishedAt: parseDate(r["Publish Date"]) ?? parseDate(r["Created Date"]),
      featured: true,
      featuredRank: rank,
      active: true,
    });
    rank++;
    if (result === "inserted") inserted++;
    else updated++;
  }
  console.log(`  feed csv: inserted ${inserted}, updated ${updated}`);
}

async function logFinalSummary(): Promise<void> {
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(collateralTable);
  const rowsWithSource = await db
    .select({ value: count() })
    .from(collateralTable)
    .where(eq(collateralTable.active, true));
  console.log(
    `  final: ${total} total collateral rows, ${rowsWithSource[0].value} active`,
  );
}

async function main(): Promise<void> {
  console.log("Seeding collateral table…");
  await seedMockData();
  console.log("Phase 2: Importing CSV catalog…");
  await ingestCollateralCsv();
  await ingestFeedCsv();
  await logFinalSummary();
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
  main()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}
