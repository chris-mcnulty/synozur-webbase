/**
 * Seed script: populates the `collateral` table from the mock data that was
 * previously served by artifacts/synozur/src/data/collateral.ts.
 * Idempotent — re-running does nothing if rows already exist.
 */
import { db, collateralTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const MOCK_DATA = [
  {
    id: "techcon-365-seattle",
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
    id: "polaris-strategy-unplugged-with-dr-john-hillen",
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
    id: "holiday-reflections-from-synozur-a-dynamic-2024",
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
    id: "transforming-your-digital-workplace-akumina",
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
    id: "energy-company-reinvents-employee-expereince-and-effectiveness",
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
    id: "transforming-management-frameworks-at-microsoft",
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
    id: "polaris-ai-predictions-2025",
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
    id: "ai-readiness-white-paper",
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
    id: "north-star-strategy-white-paper",
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
    id: "modern-intranet-webinar",
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
    id: "orion-ai-model",
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
    id: "ai-academy-immersive-ai-leadership-day",
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

async function main() {
  console.log("Seeding collateral table…");
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
      subtitle: item.subtitle ?? null,
      description: item.description,
      heroImage: item.heroImage,
      pillar: item.pillar ?? null,
      tags: item.tags ?? [],
      url: item.url,
      external: item.external ?? false,
      publishedAt: item.publishedAt ?? null,
      featured: item.featured ?? false,
      featuredRank: item.featuredRank ?? null,
      videoUrl: item.videoUrl ?? null,
      downloadUrl: item.downloadUrl ?? null,
      active: true,
    });
    inserted++;
  }

  console.log(`Done. Inserted: ${inserted}, Skipped (already exists): ${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
