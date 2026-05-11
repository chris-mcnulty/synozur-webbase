import { eq } from "drizzle-orm";
import {
  db,
  landingPagesTable,
  type LandingPageBlock,
} from "@workspace/db";
import { logger } from "./logger";

// Seeds the initial DB-backed copy of the /ai-training landing page so the
// migration from the static `pages/ai-training.tsx` is fully self-applying
// on first deploy. Idempotent: upserts by slug. If the row already exists
// we leave it alone — editors get to keep their changes across restarts.

const AI_TRAINING_BLOCKS: LandingPageBlock[] = [
  {
    type: "hero",
    eyebrow: "AI Training",
    title: "Capitalize on AI, fast.",
    subtitle:
      "We've compiled the Microsoft Copilot training resources we recommend to clients. Whether you're getting your team to the basics or building custom agents, these courses — mostly on Microsoft Learn — have you covered.",
    theme: "nebula",
  },
  {
    type: "cardGrid",
    heading: "Recommended courses",
    intro:
      "Each link goes through aka.synozur.com so we can keep the destinations current as Microsoft updates them.",
    cards: [
      {
        code: "CP101",
        title: "Work Smarter with Copilot",
        description:
          "A great starting point that shows how to use Copilot across everyday apps to research, draft, and generate content more efficiently.",
        level: "Beginner",
        url: "https://aka.synozur.com/CP101",
        source: "Microsoft Learn",
      },
      {
        code: "CP102",
        title: "Get Started with Microsoft 365 Copilot",
        description:
          "Introduces using Copilot inside Word, Excel, Outlook, PowerPoint, and Teams. Perfect for showing your workforce concrete examples of streamlining workflows — like generating PowerPoint slides from a Word doc, or summarizing Teams meetings.",
        level: "Beginner",
        url: "https://aka.synozur.com/CP102",
        source: "Microsoft Learn",
      },
      {
        code: "CP103",
        title: "Create Agents in Microsoft Copilot Studio",
        description:
          "A more advanced course on building custom AI chatbots (agents) with low-code tools. Ideal if you're intrigued by customizing Copilot for specific processes — SharePoint agents, support flows, or other targeted use cases.",
        level: "Advanced",
        url: "https://aka.synozur.com/CP103",
        source: "Microsoft Learn",
      },
      {
        code: "CP104",
        title: "Copilot for Power Platform (Power Apps & Power Automate)",
        description:
          "Shows how to use Copilot within the Power Platform to rapidly develop apps and workflows using natural language. Great for developers and technically inclined staff to accelerate solution-building.",
        level: "Intermediate",
        url: "https://aka.synozur.com/CP104",
        source: "Microsoft Learn",
      },
      {
        code: "CP105",
        title: "Power Platform Solutions with AI",
        description:
          "Explores integrating GPT-powered Copilot features into automations and apps so AI becomes part of the fabric of your business processes — not a bolt-on.",
        level: "Intermediate",
        url: "https://aka.synozur.com/CP105",
        source: "Microsoft Learn",
      },
      {
        code: "CP106 + CP107",
        title: "GitHub Copilot Fundamentals (Parts 1 & 2)",
        description:
          "If your organization writes software, these two courses cover GitHub Copilot for AI pair-programming — using Copilot to write code, tests, and even reason about existing code. A boon for developer productivity.",
        level: "Intermediate",
        url: "https://aka.synozur.com/CP106",
        source: "Microsoft Learn",
      },
      {
        code: "CP108",
        title: "30-Day AI Productivity Journey",
        description:
          "A structured daily learning path to become a Copilot power user in one month. A fun team challenge or pilot program for early adopters.",
        level: "Beginner",
        url: "https://aka.synozur.com/CP108",
        source: "Microsoft Learn",
      },
      {
        code: "CP109",
        title: "Getting Started with Microsoft Copilot (Video)",
        description:
          "A two-hour video course co-produced with Microsoft, covering setup and usage of M365 Copilot across apps. Best for visual learners and lunch-and-learn settings.",
        level: "Beginner",
        url: "https://aka.synozur.com/CP109",
        source: "Microsoft (Video)",
      },
      {
        code: "CPAcademy",
        title: "Microsoft Copilot Academy",
        description:
          "A learning path available via Microsoft Viva Learning, aimed at organizations who want to skill up employees on Copilot in a structured, trackable way.",
        level: "Intermediate",
        url: "https://aka.synozur.com/CPAcademy",
        source: "Microsoft Viva Learning",
      },
    ],
  },
  {
    type: "cta",
    heading: "Need help turning training into adoption?",
    body: "Courses build skills. We help you build the operating model around them — so AI productivity actually shows up in the business.",
    theme: "nebula",
    buttons: [
      {
        label: "See AI Strategy & Design",
        href: "/solutions/ai-strategy-and-design",
        variant: "primary",
      },
      { label: "Talk to us", href: "/contact", variant: "secondary" },
    ],
  },
];

const AI_TRAINING_SEED = {
  slug: "ai-training",
  title: "AI Training",
  status: "published" as const,
  seoTitle: "AI Training",
  seoDescription:
    "A curated set of Microsoft Copilot training resources — from getting-started guides to building custom agents and using Copilot inside the Power Platform. Hand-picked by Synozur.",
  blocks: AI_TRAINING_BLOCKS,
};

export async function seedLandingPagesIfMissing(): Promise<void> {
  try {
    const existing = await db.query.landingPagesTable.findFirst({
      where: eq(landingPagesTable.slug, AI_TRAINING_SEED.slug),
    });
    if (existing) return;
    await db.insert(landingPagesTable).values({
      slug: AI_TRAINING_SEED.slug,
      title: AI_TRAINING_SEED.title,
      status: AI_TRAINING_SEED.status,
      blocks: AI_TRAINING_SEED.blocks,
      seoTitle: AI_TRAINING_SEED.seoTitle,
      seoDescription: AI_TRAINING_SEED.seoDescription,
      publishedAt: new Date(),
    });
    logger.info(
      { slug: AI_TRAINING_SEED.slug },
      "Seeded initial landing page",
    );
  } catch (err) {
    // Seeding is best-effort — a failure shouldn't block the server from
    // booting. An empty landing_pages table just means /ai-training will
    // 404 until an admin creates the row by hand.
    logger.error({ err }, "Landing pages seed failed");
  }
}
