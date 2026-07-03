/**
 * Seed / upsert seo_title + seo_description for the 10 resource list-page
 * slugs in content_parent_pages. Safe to run on any environment — uses
 * INSERT … ON CONFLICT DO UPDATE so it creates rows that are missing and
 * fills in copy that is still NULL without overwriting admin edits on
 * seo_title or seo_description that already have a value.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed:content-parent-pages
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const ROWS = [
  {
    slug: "case-studies",
    seoTitle: "Case Studies — The Synozur Alliance",
    seoDescription:
      "Selected stories of transformation. The strategies, the work, and the outcomes.",
  },
  {
    slug: "applications",
    seoTitle: "Applications — The Synozur Alliance",
    seoDescription:
      "Synozur's portfolio of AI-powered applications — Vega, Nebula, Constellation, Orion, Orbit, Zenith, and more.",
  },
  {
    slug: "models",
    seoTitle: "Maturity Models — The Synozur Alliance",
    seoDescription:
      "AI, KMMM, GTM, Content Management, and Company OS maturity models from The Synozur Alliance.",
  },
  {
    slug: "workshops",
    seoTitle: "Workshops — The Synozur Alliance",
    seoDescription:
      "Structured facilitated sessions that accelerate strategy, alignment, and transformation with your leadership team.",
  },
  {
    slug: "library",
    seoTitle: "Library — The Synozur Alliance",
    seoDescription:
      "Browse the full Synozur collateral library — white papers, webinars, case studies, podcasts, models, workshops, and more.",
  },
  {
    slug: "webinars",
    seoTitle: "Webinars — The Synozur Alliance",
    seoDescription:
      "Watch and revisit Synozur webinars on transformation, AI, the digital workplace, and more.",
  },
  {
    slug: "videos",
    seoTitle: "Videos — The Synozur Alliance",
    seoDescription:
      "Watch interviews, webinars, and conversations from Synozur leaders and partners.",
  },
  {
    slug: "white-papers",
    seoTitle: "White Papers & eBooks — The Synozur Alliance",
    seoDescription:
      "In-depth white papers, reports, and eBooks from the Synozur team on transformation, AI, and the digital workplace.",
  },
  {
    slug: "items",
    seoTitle: "White Papers — The Synozur Alliance",
    seoDescription:
      "Read Synozur white papers on transformation strategy, technology, AI, experiences, and go-to-market.",
  },
  {
    slug: "insights",
    seoTitle: "Insights — The Synozur Alliance",
    seoDescription:
      "The Feed. Original writing on transformation, technology, leadership, and the operating disciplines that let strategy actually ship.",
  },
] as const;

async function seed() {
  console.log(`Seeding ${ROWS.length} content_parent_pages rows…`);

  for (const row of ROWS) {
    await db.execute(sql`
      INSERT INTO content_parent_pages (slug, seo_title, seo_description)
      VALUES (${row.slug}, ${row.seoTitle}, ${row.seoDescription})
      ON CONFLICT (slug) DO UPDATE
        SET
          seo_title       = COALESCE(content_parent_pages.seo_title,       EXCLUDED.seo_title),
          seo_description = COALESCE(content_parent_pages.seo_description, EXCLUDED.seo_description)
    `);
    console.log(`  ✓ ${row.slug}`);
  }

  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
