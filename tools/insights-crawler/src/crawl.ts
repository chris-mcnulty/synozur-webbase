import { load, type CheerioAPI } from "cheerio";
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import sharp from "sharp";
import { resolve, extname } from "node:path";
import { writeFile, readFile, stat } from "node:fs/promises";
import {
  ensureDir,
  ensureParent,
  fetchBuffer,
  fetchText,
  fileExists,
  fmtBytes,
  pMap,
  readJson,
  writeJson,
} from "./util.js";
import { PostsFileSchema, type Post, type PostImage } from "./schema.js";

const OUTPUT_DIR = resolve(import.meta.dirname, "../output");
const IMAGES_DIR = `${OUTPUT_DIR}/images`;
const POSTS_PATH = `${OUTPUT_DIR}/posts.json`;
const REPORT_PATH = `${OUTPUT_DIR}/report.md`;
const CACHE_DIR = `${OUTPUT_DIR}/.cache`;

const FORCE = process.argv.includes("--force");
const ONLY_SLUG = process.argv.find((a) => a.startsWith("--slug="))?.slice(7);
const MAX_IMAGE_WIDTH = 1920;
const PARALLELISM = 4;

interface DiscoveredPost {
  url: string;
  slug: string;
  lastmod: string | null;
  heroImageUrl: string | null;
}

interface RunStatus {
  slug: string;
  url: string;
  status: "ok" | "partial" | "failed";
  notes: string[];
  imageCount: number;
  bytes: number;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

function getMeta($: CheerioAPI, attr: string, key: string): string | null {
  const el = $(`meta[${attr}="${key}"]`).first();
  if (!el.length) return null;
  const v = el.attr("content");
  return v && v.trim() ? v.trim() : null;
}

function parseJsonLd($: CheerioAPI): Record<string, unknown> | null {
  const blocks = $('script[type="application/ld+json"]');
  for (const el of blocks.toArray()) {
    const raw = $(el).contents().text();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (
          item &&
          typeof item === "object" &&
          (item as { "@type"?: unknown })["@type"] === "BlogPosting"
        ) {
          return item as Record<string, unknown>;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function stripWixTransform(url: string): string {
  // https://static.wixstatic.com/media/<id>~mv2.<ext>/v1/fill/w_1000,h_667,.../<id>~mv2.<ext>
  // Drop everything after the first /v1/ segment to get original.
  const i = url.indexOf("/v1/");
  if (i !== -1) return url.slice(0, i);
  return url;
}

function inferExtFromUrl(url: string): string {
  const noQuery = url.split("?")[0]!;
  const ext = extname(noQuery).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"].includes(ext)) {
    return ext === ".jpeg" ? ".jpg" : ext;
  }
  return ".jpg";
}

interface DownloadedImage {
  localAbsPath: string;
  localRelPath: string; // relative to OUTPUT_DIR
  bytes: number;
}

async function downloadAndSaveImage(
  url: string,
  destDirAbs: string,
  destDirRel: string,
  basename: string,
): Promise<DownloadedImage | null> {
  const cleanedUrl = stripWixTransform(url);
  const ext = inferExtFromUrl(cleanedUrl);
  const fileName = `${basename}${ext}`;
  const absPath = `${destDirAbs}/${fileName}`;
  const relPath = `${destDirRel}/${fileName}`;
  if (!FORCE && (await fileExists(absPath))) {
    const st = await stat(absPath);
    return { localAbsPath: absPath, localRelPath: relPath, bytes: st.size };
  }
  let buf: Buffer;
  try {
    buf = await fetchBuffer(cleanedUrl);
  } catch (err) {
    // Retry with original (sometimes the v1/ form is required)
    try {
      buf = await fetchBuffer(url);
    } catch {
      console.warn(
        `  ! failed to download image: ${cleanedUrl} (${(err as Error).message})`,
      );
      return null;
    }
  }
  await ensureDir(destDirAbs);
  if (ext !== ".svg" && ext !== ".gif") {
    try {
      const img = sharp(buf, { failOn: "none" });
      const meta = await img.metadata();
      if (meta.width && meta.width > MAX_IMAGE_WIDTH) {
        buf = await img.resize({ width: MAX_IMAGE_WIDTH }).toBuffer();
      }
    } catch {
      // sharp can fail on exotic formats; just save the original buffer
    }
  }
  await writeFile(absPath, buf);
  return { localAbsPath: absPath, localRelPath: relPath, bytes: buf.length };
}

function getCategories($: CheerioAPI): string[] {
  // Wix renders the post's category chips in a list inside the post footer area.
  // These links use class "Tp7c0d" (Wix's hashed class for the post-page category
  // chip) and live near data-hook="post-footer". The site-wide top navigation also
  // links to /insights/categories/ but uses different classes, so we scope by either.
  const set = new Set<string>();
  // Preferred: scope to post-footer
  $('[data-hook="post-footer"] a[href*="/insights/categories/"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text) set.add(text);
  });
  if (set.size > 0) return [...set].sort();
  // Fallback: the post-page category chip class
  $('a.Tp7c0d[href*="/insights/categories/"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text) set.add(text);
  });
  return [...set].sort();
}

function getReadingTime($: CheerioAPI): number | null {
  const el = $('[data-hook="time-to-read"]').first();
  if (!el.length) return null;
  const t = el.attr("title") ?? el.text();
  const m = /(\d+)\s*min/i.exec(t);
  return m ? Number(m[1]) : null;
}

function extractBodyHtml($: CheerioAPI): string | null {
  const el = $('[data-hook="post-description"]').first();
  if (!el.length) return null;
  // Remove Wix-only loader skeletons and image-expand controls
  el.find('[data-hook="skeleton-loader"]').remove();
  el.find('[data-hook="image-expand-button"]').remove();
  el.find("button").remove();
  return el.html() ?? null;
}

function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "ul",
      "ol",
      "li",
      "blockquote",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "sub",
      "sup",
      "code",
      "pre",
      "a",
      "img",
      "figure",
      "figcaption",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "div",
      "span",
      "iframe",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      iframe: ["src", "title", "allow", "allowfullscreen", "width", "height"],
      "*": [],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { iframe: ["https"] },
    transformTags: {
      // Normalize H1 (which Wix sometimes emits inside body) to H2 so the post body always starts at H2.
      h1: "h2",
    },
    exclusiveFilter: (frame) => {
      // Drop empty divs/spans with no children
      if (
        (frame.tag === "div" || frame.tag === "span") &&
        !frame.text.trim() &&
        !/<(img|iframe|figure|h\d|ul|ol|li|p|table|blockquote|hr|br)/i.test(
          frame.mediaChildren.join("") + frame.text,
        )
      ) {
        return false;
      }
      return false;
    },
  });
}

function unwrapWixWrappers(html: string): string {
  // Remove leftover empty <div></div> wrappers
  let prev = "";
  let cur = html;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/<div>\s*(<(?:p|h\d|ul|ol|figure|blockquote|hr|table|pre)[\s\S]*?>)/gi, "$1");
    cur = cur.replace(/<\/div>\s*<div>/gi, "");
    cur = cur.replace(/<div>\s*<\/div>/gi, "");
  }
  return cur.trim();
}

interface ExtractResult {
  post: Post;
  status: RunStatus;
}

async function extractPost(d: DiscoveredPost): Promise<ExtractResult> {
  const cachePath = `${CACHE_DIR}/${d.slug}.html`;
  let html: string;
  if (!FORCE && (await fileExists(cachePath))) {
    html = await readFile(cachePath, "utf8");
  } else {
    html = await fetchText(d.url);
    await ensureParent(cachePath);
    await writeFile(cachePath, html, "utf8");
  }

  const $ = load(html);
  const notes: string[] = [];
  const ld = parseJsonLd($);

  const title =
    asString(ld?.headline) ??
    getMeta($, "property", "og:title") ??
    $('[data-hook="post-title"]').first().text().trim() ??
    "";

  const description =
    asString(ld?.description) ?? getMeta($, "property", "og:description");
  const seoTitle = getMeta($, "name", "twitter:title") ?? title;
  const ogImage = getMeta($, "property", "og:image");

  const author =
    (ld?.author && typeof ld.author === "object"
      ? asString((ld.author as Record<string, unknown>).name)
      : null) ?? getMeta($, "property", "article:author");
  const authorUrl =
    ld?.author && typeof ld.author === "object"
      ? asString((ld.author as Record<string, unknown>).url)
      : null;

  const publishedAt =
    asString(ld?.datePublished) ?? getMeta($, "property", "article:published_time");
  const updatedAt =
    asString(ld?.dateModified) ?? getMeta($, "property", "article:modified_time");

  const heroOriginal: string | null =
    (ld?.image && typeof ld.image === "object"
      ? asString((ld.image as Record<string, unknown>).url)
      : null) ??
    ogImage ??
    d.heroImageUrl;

  const slug = d.slug;
  const imageDirAbs = `${IMAGES_DIR}/${slug}`;
  const imageDirRel = `images/${slug}`;

  let heroImage: PostImage | null = null;
  if (heroOriginal) {
    const dl = await downloadAndSaveImage(heroOriginal, imageDirAbs, imageDirRel, "hero");
    if (dl) {
      heroImage = {
        originalUrl: heroOriginal,
        localPath: dl.localRelPath,
        bytes: dl.bytes,
      };
    } else {
      notes.push(`hero image failed: ${heroOriginal}`);
    }
  } else {
    notes.push("no hero image found");
  }

  const rawBody = extractBodyHtml($);
  let bodyHtml = "";
  let bodyMd = "";
  const bodyImages: PostImage[] = [];
  let status: "ok" | "partial" | "failed" = "ok";
  if (!rawBody || rawBody.trim().length < 40) {
    notes.push("post body not found in SSR'd HTML");
    status = "partial";
  } else {
    let sanitized = sanitizeBody(rawBody);
    sanitized = unwrapWixWrappers(sanitized);

    // Find inline images, download (deduped by stripped Wix URL), rewrite.
    // Wix often emits a low-res blur placeholder <img> as the SSR'd src; once we
    // strip the /v1/fill/... transform we get the canonical original URL, so
    // multiple placeholder variants of the same asset collapse to one download.
    const $$ = load(sanitized, null, false);
    const imgs = $$("img").toArray();
    const dedupe = new Map<string, string>(); // canonical original URL -> local rel path
    const heroCanonical = heroOriginal ? stripWixTransform(heroOriginal) : null;
    let counter = 1;
    for (const el of imgs) {
      const src = $$(el).attr("src");
      if (!src) continue;
      if (!/^https?:\/\//.test(src)) continue;
      const isWix = /static\.wixstatic\.com|wixstatic\.com/.test(src);
      if (!isWix) continue; // leave non-Wix external images untouched
      const canonical = stripWixTransform(src);
      // Skip if this image is just a placeholder for the hero we already downloaded.
      if (heroCanonical && canonical === heroCanonical && heroImage) {
        $$(el).attr("src", heroImage.localPath);
        continue;
      }
      const cached = dedupe.get(canonical);
      if (cached) {
        $$(el).attr("src", cached);
        continue;
      }
      const dl = await downloadAndSaveImage(
        src,
        imageDirAbs,
        imageDirRel,
        `body-${String(counter).padStart(3, "0")}`,
      );
      counter += 1;
      if (!dl) {
        notes.push(`inline image failed: ${src}`);
        status = "partial";
        continue;
      }
      dedupe.set(canonical, dl.localRelPath);
      bodyImages.push({
        originalUrl: canonical,
        localPath: dl.localRelPath,
        bytes: dl.bytes,
      });
      $$(el).attr("src", dl.localRelPath);
    }
    bodyHtml = $$.html();
    bodyMd = turndown.turndown(bodyHtml);
  }

  const post: Post = {
    slug,
    sourceUrl: d.url,
    title: title || slug,
    subtitle: null,
    excerpt: description,
    authorName: author,
    authorUrl,
    publishedAt,
    updatedAt,
    readingTimeMinutes: getReadingTime($),
    categories: getCategories($),
    tags: [],
    heroImage,
    bodyHtml,
    bodyMarkdown: bodyMd,
    bodyImages,
    seo: {
      title: seoTitle,
      description,
      ogImage,
    },
    status,
    notes,
  };

  const totalBytes =
    (heroImage?.bytes ?? 0) + bodyImages.reduce((s, i) => s + i.bytes, 0);

  return {
    post,
    status: {
      slug,
      url: d.url,
      status,
      notes,
      imageCount: (heroImage ? 1 : 0) + bodyImages.length,
      bytes: totalBytes,
    },
  };
}

async function main() {
  const discovered = await readJson<DiscoveredPost[]>(`${OUTPUT_DIR}/discovered.json`);
  if (!discovered || discovered.length === 0) {
    console.error(
      `No discovered posts found. Run: pnpm --filter @workspace/insights-crawler run discover`,
    );
    process.exit(1);
  }
  const targets = ONLY_SLUG ? discovered.filter((d) => d.slug === ONLY_SLUG) : discovered;
  if (targets.length === 0) {
    console.error(`No posts match slug filter: ${ONLY_SLUG}`);
    process.exit(1);
  }

  console.log(
    `Crawling ${targets.length} posts (parallelism=${PARALLELISM}, force=${FORCE})...`,
  );

  // Load existing posts.json so we can merge if not --force
  let existing: Post[] = [];
  if (!FORCE) {
    const prev = await readJson<Post[]>(POSTS_PATH);
    if (prev) existing = prev;
  }
  const existingBySlug = new Map(existing.map((p) => [p.slug, p]));

  const statuses: RunStatus[] = [];
  let completed = 0;

  await pMap(targets, PARALLELISM, async (d) => {
    try {
      const cached = existingBySlug.get(d.slug);
      if (
        !FORCE &&
        cached &&
        cached.status === "ok" &&
        cached.updatedAt === (d.lastmod ? null : cached.updatedAt)
      ) {
        // Already extracted; skip extraction, but still record status
        statuses.push({
          slug: d.slug,
          url: d.url,
          status: cached.status,
          notes: ["cached"],
          imageCount:
            (cached.heroImage ? 1 : 0) + cached.bodyImages.length,
          bytes:
            (cached.heroImage?.bytes ?? 0) +
            cached.bodyImages.reduce((s, i) => s + i.bytes, 0),
        });
      } else {
        const { post, status } = await extractPost(d);
        existingBySlug.set(d.slug, post);
        statuses.push(status);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      statuses.push({
        slug: d.slug,
        url: d.url,
        status: "failed",
        notes: [message],
        imageCount: 0,
        bytes: 0,
      });
      console.error(`  ! ${d.slug}: ${message}`);
    }
    completed += 1;
    if (completed % 10 === 0 || completed === targets.length) {
      console.log(`  ...${completed}/${targets.length}`);
    }
  });

  // Compose final posts list (deterministic order: publishedAt desc, then slug)
  const all = [...existingBySlug.values()].sort((a, b) => {
    const ap = a.publishedAt ?? "";
    const bp = b.publishedAt ?? "";
    if (ap !== bp) return bp.localeCompare(ap);
    return a.slug.localeCompare(b.slug);
  });
  for (const p of all) {
    p.categories = [...p.categories].sort();
    p.tags = [...p.tags].sort();
  }

  // Validate
  const parsed = PostsFileSchema.safeParse(all);
  if (!parsed.success) {
    console.error("Schema validation failed:", parsed.error.format());
    process.exit(1);
  }
  await writeJson(POSTS_PATH, parsed.data);

  // Build report.md
  const okCount = statuses.filter((s) => s.status === "ok").length;
  const partialCount = statuses.filter((s) => s.status === "partial").length;
  const failedCount = statuses.filter((s) => s.status === "failed").length;
  const totalImages = statuses.reduce((s, x) => s + x.imageCount, 0);
  const totalBytes = statuses.reduce((s, x) => s + x.bytes, 0);

  const lines: string[] = [];
  lines.push(`# Insights Crawl Report`);
  lines.push("");
  lines.push(`- Run completed: ${new Date().toISOString()}`);
  lines.push(`- Discovered posts: ${discovered.length}`);
  lines.push(`- Crawled this run: ${statuses.length}`);
  lines.push(`- Status: ok=${okCount}, partial=${partialCount}, failed=${failedCount}`);
  lines.push(`- Images downloaded (this run): ${totalImages}`);
  lines.push(`- Bytes downloaded (this run): ${fmtBytes(totalBytes)}`);
  lines.push(`- Total posts in dataset: ${all.length}`);
  lines.push("");
  lines.push(`## Per-post status`);
  lines.push("");
  lines.push(`| Slug | Status | Images | Bytes | Notes |`);
  lines.push(`| ---- | ------ | ------ | ----- | ----- |`);
  const sorted = [...statuses].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const s of sorted) {
    const notes = s.notes.length ? s.notes.join("; ") : "";
    lines.push(
      `| ${s.slug} | ${s.status} | ${s.imageCount} | ${fmtBytes(s.bytes)} | ${notes.replace(/\|/g, "/")} |`,
    );
  }
  await writeFile(REPORT_PATH, lines.join("\n") + "\n", "utf8");

  console.log(``);
  console.log(`Wrote ${all.length} posts -> ${POSTS_PATH}`);
  console.log(`Wrote report -> ${REPORT_PATH}`);
  console.log(`Status: ok=${okCount}, partial=${partialCount}, failed=${failedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
