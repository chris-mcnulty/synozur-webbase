import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";
import { JsonLd } from "@/components/jsonld";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/seo-config";

type ResourceLevel = "Beginner" | "Intermediate" | "Advanced";

type Resource = {
  code: string;
  title: string;
  description: string;
  level: ResourceLevel;
  url: string;
  source: string;
};

const RESOURCES: Resource[] = [
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
];

const LEVEL_CLASS: Record<ResourceLevel, string> = {
  Beginner: "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/20",
  Intermediate: "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-400/20",
  Advanced: "bg-fuchsia-500/10 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-400/20",
};

export default function AiTraining() {
  const canonicalUrl = `${SITE_ORIGIN}/ai-training`;
  const description =
    "A curated set of Microsoft Copilot training resources — from getting-started guides to building custom agents and using Copilot inside the Power Platform. Hand-picked by Synozur.";

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "AI Training",
    url: canonicalUrl,
    description,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_ORIGIN,
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: RESOURCES.length,
      itemListElement: RESOURCES.map((r, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: r.url,
        name: r.title,
      })),
    },
  };

  return (
    <div className="w-full">
      <Meta
        title="AI Training"
        description={description}
        canonicalPath="/ai-training"
      />
      <JsonLd data={itemListJsonLd} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto max-w-4xl px-4">
          <p className="mb-4 inline-flex items-center gap-2 text-sm uppercase tracking-widest text-primary">
            <Sparkles className="h-4 w-4" />
            AI Training
          </p>
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-white md:text-7xl">
            Capitalize on AI, fast.
          </h1>
          <p className="max-w-3xl text-xl leading-relaxed text-zinc-300 md:text-2xl">
            We've compiled the Microsoft Copilot training resources we recommend
            to clients. Whether you're getting your team to the basics or
            building custom agents, these courses — mostly on Microsoft Learn —
            have you covered.
          </p>
        </div>
      </section>

      {/* Resource grid */}
      <section className="bg-background py-20 md:py-24">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Recommended courses
            </h2>
            <p className="mt-3 text-muted-foreground">
              Each link goes through{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                aka.synozur.com
              </code>{" "}
              so we can keep the destinations current as Microsoft updates them.
            </p>
          </div>

          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {RESOURCES.map((r, i) => (
              <motion.li
                key={r.code}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.3) }}
              >
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/60 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  data-testid={`resource-card-${r.code.toLowerCase().replace(/\s+\+\s+/g, "-")}`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {r.code}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${LEVEL_CLASS[r.level]}`}
                    >
                      {r.level}
                    </span>
                  </div>
                  <h3 className="mb-2 text-lg font-semibold leading-snug">
                    {r.title}
                  </h3>
                  <p className="mb-4 flex-grow text-sm text-muted-foreground">
                    {r.description}
                  </p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{r.source}</span>
                    <span className="inline-flex items-center gap-1 font-medium text-primary group-hover:gap-1.5 transition-all">
                      Open course
                      <ExternalLink className="h-3 w-3" />
                    </span>
                  </div>
                </a>
              </motion.li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-border bg-[#0B0B1A] py-20">
        <div className="absolute inset-0 nebula-gradient opacity-15" />
        <div className="container relative z-10 mx-auto max-w-3xl px-4 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
            Need help turning training into adoption?
          </h2>
          <p className="mb-8 text-lg text-zinc-300">
            Courses build skills. We help you build the operating model around
            them — so AI productivity actually shows up in the business.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/solutions/ai-strategy-and-design"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              See AI Strategy &amp; Design
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-11 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-medium text-white hover:bg-white/10"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
