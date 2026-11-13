/**
 * Read-only restoration inventory. Deliberately does not import ingest,
 * backfill, database, storage, or crawler modules; never fetches remote URLs.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { load } from "cheerio";
import sharp from "sharp";
import { PostsFileSchema, PostSchema, type Post } from "./schema.js";

export interface PreflightIssue {
  code: string;
  location: string;
  message: string;
}

export interface PreflightReport {
  ok: boolean;
  postsPath: string;
  posts: number;
  imageFiles: number;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function isLocal(value: string): boolean {
  return value.trim() !== "" && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value);
}

function contentImages(post: Post): string[] {
  const refs: string[] = [];
  const $ = load(post.bodyHtml);
  $("img, source").each((_, el) => {
    const src = $(el).attr("src");
    if (src && isLocal(src)) refs.push(src);
    const srcset = $(el).attr("srcset");
    if (srcset && !srcset.trim().startsWith("data:")) {
      for (const candidate of srcset.split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url && isLocal(url)) refs.push(url);
      }
    }
  });
  // Crawler-generated Markdown uses inline images (not reference definitions).
  for (const match of post.bodyMarkdown.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
    const url = match[1] ?? match[2];
    if (isLocal(url)) refs.push(url);
  }
  if (post.seo.ogImage && isLocal(post.seo.ogImage)) refs.push(post.seo.ogImage);
  return refs;
}

export async function restorationPreflight(
  outputDir = resolve(import.meta.dirname, "../output"),
): Promise<PreflightReport> {
  const root = resolve(outputDir);
  const report: PreflightReport = {
    ok: false, postsPath: resolve(root, "posts.json"), posts: 0,
    imageFiles: 0, errors: [], warnings: [],
  };
  const error = (code: string, location: string, message: string) =>
    report.errors.push({ code, location, message });

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(report.postsPath, "utf8"));
  } catch (err) {
    error("posts_unreadable", report.postsPath, String(err));
    return report;
  }
  const parsed = PostsFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      error("schema_invalid", `posts.${issue.path.join(".")}`, issue.message);
    }
  }
  // Inspect valid records even if another record is invalid.
  const posts = parsed.success ? parsed.data : Array.isArray(raw)
    ? raw.flatMap((value) => {
        const post = PostSchema.safeParse(value);
        return post.success ? [post.data] : [];
      }) : [];
  report.posts = posts.length;
  if (Array.isArray(raw) && raw.length === 0) {
    error("posts_empty", report.postsPath, "No historical posts to restore.");
  }

  const images = new Map<string, { locations: Set<string>; sizes: Set<number> }>();
  const addImage = (path: string, location: string, bytes?: number) => {
    const entry = images.get(path) ?? { locations: new Set<string>(), sizes: new Set<number>() };
    entry.locations.add(location);
    if (bytes !== undefined) entry.sizes.add(bytes);
    images.set(path, entry);
  };
  const slugs = new Set<string>();
  for (const post of posts) {
    if (slugs.has(post.slug)) error("duplicate_slug", post.slug, "Duplicate slug would collide during ingest.");
    slugs.add(post.slug);
    if (post.status !== "ok") {
      report.warnings.push({
        code: "crawl_status", location: post.slug,
        message: `${post.status}: ${post.notes.join("; ")}${post.status === "failed" ? " (ingest skips this post)" : ""}`,
      });
    }
    if (post.heroImage) addImage(post.heroImage.localPath, `${post.slug}.heroImage`, post.heroImage.bytes);
    for (const [index, image] of post.bodyImages.entries()) {
      addImage(image.localPath, `${post.slug}.bodyImages.${index}`, image.bytes);
    }
    for (const path of contentImages(post)) addImage(path, `${post.slug}.content`);
  }
  report.imageFiles = images.size;
  const realRoot = await realpath(root);
  for (const [path, entry] of images) {
    const location = `${path} [${[...entry.locations].join(", ")}]`;
    const fullPath = resolve(root, path);
    if (!path.trim() || isAbsolute(path) || !inside(root, fullPath)) {
      error("image_path_invalid", location, "Image path must be relative and stay inside the dataset.");
      continue;
    }
    try {
      if (!inside(realRoot, await realpath(fullPath))) {
        error("image_path_invalid", location, "Image symlink escapes the dataset.");
        continue;
      }
      const info = await stat(fullPath);
      if (!info.isFile()) {
        error("image_not_file", location, "Expected a regular image file.");
        continue;
      }
      if (entry.sizes.size > 1 || [...entry.sizes].some((size) => size !== info.size)) {
        error("image_size_mismatch", location, `Recorded bytes: ${[...entry.sizes].join(", ")}; actual: ${info.size}.`);
      }
      // Decode pixels, not just headers, so truncated/corrupt payloads fail.
      await sharp(fullPath, { failOn: "warning" }).raw().toBuffer();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      error(code === "ENOENT" ? "image_missing" : "image_unreadable", location, String(err));
    }
  }
  report.ok = report.errors.length === 0;
  return report;
}
