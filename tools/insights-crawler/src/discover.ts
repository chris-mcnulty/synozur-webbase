import { fetchText, writeJson } from "./util.js";
import { resolve } from "node:path";

const SITE = "https://www.synozur.com";
const BLOG_SITEMAP = `${SITE}/blog-posts-sitemap.xml`;
const OUTPUT_DIR = resolve(import.meta.dirname, "../output");

interface DiscoveredPost {
  url: string;
  slug: string;
  lastmod: string | null;
  heroImageUrl: string | null;
}

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push((m[1] ?? "").trim());
  }
  return out;
}

function parseSitemap(xml: string): DiscoveredPost[] {
  // Each <url> block contains <loc>, optional <lastmod>, optional <image:image><image:loc>
  const urlBlocks = extractAll(xml, "url");
  const posts: DiscoveredPost[] = [];
  const seen = new Set<string>();
  for (const block of urlBlocks) {
    const loc = extractAll(block, "loc")[0];
    if (!loc) continue;
    const lastmod = extractAll(block, "lastmod")[0] ?? null;
    const imgLoc = extractAll(block, "image:loc")[0] ?? null;
    if (!loc.includes("/post/")) continue;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const slug = loc.split("/post/")[1]!.replace(/\/+$/, "");
    posts.push({ url: loc, slug, lastmod, heroImageUrl: imgLoc });
  }
  return posts;
}

async function main() {
  console.log(`Fetching sitemap: ${BLOG_SITEMAP}`);
  const xml = await fetchText(BLOG_SITEMAP);
  const posts = parseSitemap(xml);
  posts.sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""));
  const outPath = `${OUTPUT_DIR}/discovered.json`;
  await writeJson(outPath, posts);
  console.log(`Discovered ${posts.length} posts -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
