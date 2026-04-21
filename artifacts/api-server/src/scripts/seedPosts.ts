/**
 * Seed script: populates the `posts` table from known blog-post entries.
 *
 * Sources:
 *   1. Hardcoded posts derived from From+The+Feed CSV and Collateral CSV.
 *   2. Scans the Collateral CSV for any row whose URL contains "/post/" and
 *      promotes it to the posts table using Short Description as body/excerpt.
 *
 * Idempotent — dedupes by slug using ON CONFLICT DO NOTHING.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, postsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { parseCsvAsObjects } from "../lib/csv";

const ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../attached_assets",
);

function readCsv(filename: string) {
  try {
    const text = readFileSync(resolve(ASSETS_DIR, filename), "utf8");
    return parseCsvAsObjects(text);
  } catch {
    return [];
  }
}

function toSlug(url: string) {
  return url.replace(/^\/post\//, "").replace(/\/$/, "").trim();
}

function estimateReadingTime(html: string) {
  const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

async function getAdminUserId() {
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, "chris.mcnulty@synozur.com"),
    columns: { id: true },
  });
  if (!user) throw new Error("Admin user not found — run role seed first");
  return user.id;
}

interface PostSeed {
  slug: string;
  title: string;
  excerpt: string;
  bodyHtml: string;
  publishedAt: Date;
  readingTimeMin: number;
}

async function main() {
  const authorId = await getAdminUserId();

  const collateralRows = readCsv("Collateral_1776714742837.csv");
  const feedRows = readCsv("From+The+Feed_1776706589115.csv");

  const posts: PostSeed[] = [];
  const seenSlugs = new Set<string>();

  // --- From Collateral CSV: any row with a /post/ URL ---
  for (const row of collateralRows) {
    const url: string = row["URL"] ?? row["url"] ?? "";
    if (!url.includes("/post/")) continue;
    const slug = toSlug(url);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const title: string = row["Title"] ?? row["title"] ?? "Untitled";
    const shortDesc: string = row["Short Description"] ?? row["short_description"] ?? "";
    const richDesc: string = row["Description"] ?? row["description"] ?? "";

    // Prefer Short Description HTML; fall back to stripped Ricos JSON text.
    let body = shortDesc.trim();
    if (!body && richDesc) {
      body = `<p>${richDesc.replace(/"text":"([^"]+)"/g, "$1 ").substring(0, 800)}...</p>`;
    }
    if (!body) body = `<p>${title}</p>`;

    const pubStr: string = row["Published"] ?? row["published"] ?? row["Created Date"] ?? "";
    const publishedAt = pubStr ? new Date(pubStr) : new Date("2025-01-01");

    posts.push({
      slug,
      title,
      excerpt: shortDesc.replace(/<[^>]+>/g, "").trim().substring(0, 300),
      bodyHtml: body,
      publishedAt,
      readingTimeMin: estimateReadingTime(body),
    });
  }

  // --- From the Feed CSV: any row with a /post/ URL not already captured ---
  for (const row of feedRows) {
    const url: string = row["Source Link"] ?? "";
    if (!url.includes("/post/")) continue;
    const slug = toSlug(url);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const title: string = row["Title"] ?? "Untitled";
    const desc: string = row["Description"] ?? "";
    const body = desc.trim() ? `<p>${desc}</p>` : `<p>${title}.</p>`;
    const pubStr: string = row["Publish Date"] ?? row["Created Date"] ?? "";
    const publishedAt = pubStr ? new Date(pubStr) : new Date("2025-01-01");

    posts.push({
      slug,
      title,
      excerpt: desc.substring(0, 300),
      bodyHtml: body,
      publishedAt,
      readingTimeMin: estimateReadingTime(body),
    });
  }

  // --- Hardcoded posts for which we have curated content ---
  const hardcoded: PostSeed[] = [
    {
      slug: "polaris-ai-predictions-2025",
      title: "AI Predictions for 2025",
      excerpt:
        "Synozur's leadership team shares their top predictions for how AI will reshape enterprise strategy, operations, and the future of work in 2025.",
      bodyHtml: `<p>As we move into 2025, generative AI has shifted from an experiment to a strategic imperative for enterprise leaders. At Synozur, we've been on the front lines of AI transformation for our clients, and the patterns we're seeing point toward a pivotal year ahead.</p>
<h2>1. From Pilots to Production at Scale</h2>
<p>The era of tentative AI pilots is ending. Organizations that ran 30-person Copilot pilots in 2024 are now asking: how do we roll this out to 5,000 people? The challenge is no longer "does this work?" but "how do we make this work across the entire company?" Content readiness, governance, and change management become the real differentiators.</p>
<h2>2. The Rise of the AI-Ready Data Estate</h2>
<p>AI is only as good as the data it can access. In 2025, the boardroom conversation will turn to data quality, sensitivity labels, and information architecture. Microsoft Purview, SharePoint Premium, and Dataverse will see dramatically increased adoption as organizations race to make their data estates AI-ready.</p>
<h2>3. Fractional AI Leadership</h2>
<p>Not every organization can afford a full-time Chief AI Officer. We predict a surge in fractional AI leadership — senior executives who serve multiple organizations in a part-time capacity, helping them navigate strategy, vendor selection, and organizational design around AI.</p>
<h2>4. The Human-in-the-Loop Imperative</h2>
<p>As AI capabilities expand, the most successful organizations will be those that keep humans meaningfully in the loop — not as a bottleneck, but as the source of judgment, context, and accountability that AI cannot replicate. Design for human oversight will become a competitive differentiator.</p>
<p>2025 will reward the organizations that move decisively but thoughtfully. The North Star hasn't changed — it's about guiding your organization to sustainable advantage through transformation rooted in people, powered by technology, and driven by purpose.</p>`,
      publishedAt: new Date("2025-01-15"),
      readingTimeMin: 4,
    },
    {
      slug: "holiday-reflections-from-synozur-a-dynamic-2024",
      title: "2024 — A Dynamic Year",
      excerpt:
        "A look back at an extraordinary year of transformation, new partnerships, and growth at The Synozur Alliance.",
      bodyHtml: `<p>2024 was, by any measure, a dynamic year — for our clients, for our industry, and for The Synozur Alliance. As we close the chapter on twelve months defined by rapid AI adoption, evolving workforce expectations, and strategic pivots, we want to share some reflections from our team.</p>
<h2>A Year of Transformation</h2>
<p>We supported organizations across financial services, healthcare, education technology, and the Microsoft partner ecosystem through some of their most consequential transformations. From large-scale Microsoft 365 Copilot deployments to enterprise operating system redesigns, our clients leaned into change — and came out stronger.</p>
<h2>The Polaris Podcast</h2>
<p>We launched Polaris, our strategy and leadership podcast, and were blown away by the response. Conversations with guests like Dr. John Hillen on business strategy, and thought leaders on the future of AI, generated thousands of downloads and sparked conversations we're still having today.</p>
<h2>Growing the Alliance</h2>
<p>The Synozur team grew — in headcount, in capabilities, and in the depth of relationships we've built with clients and partners. We are proud of the work and grateful to everyone who trusted us with their most important strategic challenges.</p>
<h2>Looking Ahead</h2>
<p>2025 promises to be even more dynamic. AI is no longer on the horizon — it's here, and the organizations that will thrive are those that move with intention, build with purpose, and lead with humanity. We're excited to be your partner on that journey.</p>
<p>From all of us at The Synozur Alliance — thank you, and here's to a transformative 2025.</p>`,
      publishedAt: new Date("2024-12-20"),
      readingTimeMin: 3,
    },
  ];

  for (const p of hardcoded) {
    if (!seenSlugs.has(p.slug)) {
      seenSlugs.add(p.slug);
      posts.push(p);
    }
  }

  console.log(`Seeding ${posts.length} posts…`);
  let inserted = 0;
  let skipped = 0;

  for (const p of posts) {
    const result = await db
      .insert(postsTable)
      .values({
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt || null,
        bodyHtml: p.bodyHtml,
        bodyMarkdown: null,
        authorId,
        status: "published",
        publishedAt: p.publishedAt,
        readingTimeMin: p.readingTimeMin,
        seoTitle: p.title,
        seoDescription: p.excerpt?.substring(0, 160) || null,
      })
      .onConflictDoNothing()
      .returning({ id: postsTable.id });

    if (result.length > 0) {
      inserted++;
      console.log(`  ✓ ${p.title}`);
    } else {
      skipped++;
      console.log(`  – skip (exists): ${p.slug}`);
    }
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
