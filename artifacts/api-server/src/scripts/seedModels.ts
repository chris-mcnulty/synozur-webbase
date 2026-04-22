/**
 * Seed the `models` table from known Wix CMS model data.
 *
 * The Wix collateral export contains one row of type "INTERACTIVE" at
 * /models/ai-maturity-model — the Synozur AI Maturity Model. This script
 * creates that row (and any future models added to the MODELS array below)
 * in a single idempotent pass.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedModels.ts
 *
 * Idempotent: deduplicates by slug; re-running updates existing rows.
 */
import { eq } from "drizzle-orm";
import { db, modelsTable, pool } from "@workspace/db";

interface ModelSeed {
  slug: string;
  title: string;
  shortDescription: string;
  longDescriptionHtml: string;
  heroImage: string;
  launchUrl: string;
  pillar: "strategic" | "technology" | "experiences" | "gtm" | null;
  publishedAt: Date;
  featured: boolean;
  featuredRank: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

const MODELS: ModelSeed[] = [
  {
    slug: "ai-maturity-model",
    title: "Synozur AI Maturity Model",
    shortDescription:
      "The Synozur AI Maturity Model — a practical way to benchmark your organization's AI progress and plan next steps.",
    longDescriptionHtml: `
<p>The <strong>Synozur AI Maturity Model</strong> is a practical way to benchmark your organization's AI progress and plan next steps.</p>
<p>This <strong>free, no-login tool</strong> helps you:</p>
<ul>
  <li><strong>Assess your AI maturity</strong> across five stages: Explore, Build, Scale, Transform, Frontier</li>
  <li><strong>Get tailored guidance</strong> for accelerating your AI journey</li>
  <li><strong>Download a PDF report</strong> or share results instantly with your team</li>
</ul>
<p>Start now and move from hype to measurable impact.</p>
`.trim(),
    heroImage: "",
    launchUrl: "https://aimaturity.synozur.com",
    pillar: "strategic",
    publishedAt: new Date("2025-10-12T00:00:00Z"),
    featured: true,
    featuredRank: 1,
    seoTitle: "Synozur AI Maturity Model — Assess Your AI Progress",
    seoDescription:
      "Benchmark your organization's AI maturity across five stages. Free, no-login assessment tool from Synozur. Get tailored guidance and a downloadable PDF report.",
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const m of MODELS) {
    const existing = await db.query.modelsTable.findFirst({
      where: eq(modelsTable.slug, m.slug),
    });

    if (existing) {
      await db
        .update(modelsTable)
        .set({
          title: m.title,
          shortDescription: m.shortDescription,
          longDescriptionHtml: m.longDescriptionHtml,
          heroImage: m.heroImage,
          launchUrl: m.launchUrl,
          pillar: m.pillar,
          publishedAt: m.publishedAt,
          featured: m.featured,
          featuredRank: m.featuredRank,
          seoTitle: m.seoTitle,
          seoDescription: m.seoDescription,
          status: "published",
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(modelsTable.id, existing.id));
      updated++;
      console.log(`  Updated: ${m.title}`);
    } else {
      await db.insert(modelsTable).values({
        slug: m.slug,
        title: m.title,
        shortDescription: m.shortDescription,
        longDescriptionHtml: m.longDescriptionHtml,
        heroImage: m.heroImage,
        launchUrl: m.launchUrl,
        pillar: m.pillar,
        publishedAt: m.publishedAt,
        featured: m.featured,
        featuredRank: m.featuredRank,
        seoTitle: m.seoTitle,
        seoDescription: m.seoDescription,
        status: "published",
        active: true,
      });
      created++;
      console.log(`  Created: ${m.title}`);
    }
  }

  console.log(`\nModels seed: ${created} created, ${updated} updated.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
