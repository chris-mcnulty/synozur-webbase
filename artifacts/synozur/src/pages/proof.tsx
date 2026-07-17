import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Quote,
  TrendingUp,
  Users,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  CircleDot,
} from "lucide-react";
import { Meta } from "@/lib/meta";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" },
} as const;

const SKY = {
  galaxy: `${BASE_PATH}/images/sky-galaxy-web.jpg`,
  coast: `${BASE_PATH}/images/sky-coast-web.jpg`,
  people: `${BASE_PATH}/images/sky-people-web.jpg`,
};
const SKY_CYCLE = [SKY.galaxy, SKY.coast, SKY.people];

// ── The Proof Stack — 5 anchor cases in Before / After / Impact / What-changed
// narrative form. Copy supplied by the client; real published engagements.
type ProofCase = {
  slug: string;
  archetype: string;
  client: string;
  metric: { value: string; label: string };
  before: string;
  after: string;
  impact: string[];
  changed: string[];
  image: string;
};

const PROOF_STACK: ProofCase[] = [
  {
    slug: "transforming-management-frameworks-at-microsoft",
    archetype: "Alignment → Operating Model",
    client: "Microsoft",
    metric: { value: "$0.5M–$1.0M", label: "Annual productivity cost avoidance" },
    before:
      "A Modern Work product marketing group delivered strong product results but had no coherent management framework. The upcoming multi-day offsite risked becoming a “BOPSAT” — a bunch of people sitting around talking.",
    after:
      "A working management framework — OKRs, an operating cadence, and connected goals — became the team's playbook for the year, installed during a high-impact planning offsite.",
    impact: [
      "$0.5M–$1.0M annual productivity cost avoidance",
      ">100% OKR revenue growth on key goals",
      "Multi-million revenue influence across the portfolio",
    ],
    changed: [
      "OKRs and a shared operating cadence installed",
      "A common way to plan, measure, and adjust together",
      "Planning shifted from talk to a repeatable framework",
    ],
    image: SKY.people,
  },
  {
    slug: "ai-&-governance-acceleration-for-private-equity",
    archetype: "AI → Strategic clarity",
    client: "Private Equity Firm",
    metric: { value: "Speed + control", label: "Governed AI across the portfolio" },
    before:
      "AI initiatives were emerging rapidly across the portfolio, but without coordination. Efforts risked fragmentation, duplication, and governance gaps — creating pressure to move quickly without losing control.",
    after:
      "AI efforts were aligned to a structured governance and leadership framework, balancing speed with accountability and clear decision-making.",
    impact: [
      "Improved executive alignment on AI strategy",
      "Faster, more confident decision-making",
      "Reduced duplication and fragmented initiatives",
    ],
    changed: [
      "AI initiatives governed through a unified framework",
      "Leadership aligned on priorities and risk boundaries",
      "Decisions shifted from reactive to structured and deliberate",
    ],
    image: SKY.galaxy,
  },
  {
    slug: "accelerating-go-to-market-for-a-leading-ai-isv",
    archetype: "Growth → Execution",
    client: "AI Software Company (ISV)",
    metric: { value: "$3M–$12M", label: "Incremental revenue in 12–24 months" },
    before:
      "A strong AI integration product existed, but the value was not clearly communicated. Messaging was inconsistent, go-to-market strategy was underdeveloped, and the team needed to launch quickly without clear positioning.",
    after:
      "The product was aligned to a clear market position with a structured go-to-market strategy — enabling more effective communication, faster execution, and stronger market traction.",
    impact: [
      "$3M–$12M incremental revenue within 12–24 months",
      "$250K–$500K annual cost savings",
      "Improved customer acquisition and later-stage conversion",
    ],
    changed: [
      "Messaging clarified the product's value and differentiation",
      "Go-to-market aligned sales, marketing, and product",
      "Execution shifted from fragmented activity to coordinated growth",
    ],
    image: SKY.coast,
  },
  {
    slug: "executive-ai-readiness-at-a-leading-education-technology-company",
    archetype: "Alignment under complexity",
    client: "Education Technology Company",
    metric: { value: "Board-level clarity", label: "Shared AI baseline for leaders" },
    before:
      "Leadership understood AI's potential, but lacked a shared baseline. Conversations were inconsistent, priorities were unclear, and momentum was difficult to sustain without confidence in readiness or direction.",
    after:
      "Executive alignment was established around a clear understanding of AI, enabling structured decision-making and a coordinated path forward.",
    impact: [
      "Improved leadership alignment on AI strategy",
      "Clear, prioritized roadmap for responsible adoption",
      "Increased confidence in decision-making and next steps",
    ],
    changed: [
      "Leadership developed a shared language and understanding of AI",
      "Priorities shifted from experimentation to outcome-driven decisions",
      "AI initiatives became aligned to organizational purpose and impact",
    ],
    image: SKY.galaxy,
  },
  {
    slug: "ai-and-knowledge-transformation-at-a-strategic-communications-firm",
    archetype: "AI + Operations",
    client: "Strategic Communications Firm",
    metric: { value: "Less rework", label: "AI aligned to real knowledge work" },
    before:
      "As the firm scaled, knowledge work became fragmented. Teams spent excessive time searching for information, recreating content, and working across disconnected tools. Leadership needed to introduce AI without compromising trust, credibility, or human expertise.",
    after:
      "Knowledge workflows were clarified and structured around a business-aligned AI strategy, enabling teams to work more efficiently while maintaining quality and trust.",
    impact: [
      "Reduced time spent searching for and recreating content",
      "Improved consistency across content creation and delivery",
      "Increased confidence in how AI supports, not replaces, expertise",
    ],
    changed: [
      "Knowledge workflows became more structured and connected",
      "AI aligned to real work, not isolated experimentation",
      "Teams shifted from fragmented effort to consistent execution",
    ],
    image: SKY.coast,
  },
];

// Remaining publicly-shareable engagements for the browsable library below.
const STUDIES = [
  {
    slug: "management-makeover-at-a-luxury-brand",
    client: "Luxury Manufacturing",
    industry: "Cosmeceutical",
    tag: "Strategy",
    title: "Management Makeover at a Luxury Brand",
    summary:
      "Installed a Company Operating System for a luxury manufacturer — a clear focus on priorities and performance metrics that transformed how leaders operate.",
    headline: "$0.6M–$1.3M cost savings + revenue enablement",
  },
  {
    slug: "energy-company-reinvents-employee-expereince-and-effectiveness",
    client: "North American Energy Company",
    industry: "Energy",
    tag: "Employee Effectiveness",
    title: "Energy company reinvents employee experience and effectiveness",
    summary:
      "Revolutionized how 12,000+ employees interact and collaborate, unifying five experience themes and positioning the company for greater innovation.",
    headline: "$2.0M–$6.0M annual productivity gains",
  },
  {
    slug: "ai-transformation-at-a-private-equity-portfolio-company",
    client: "Financial Services",
    industry: "Private Equity",
    tag: "Technology",
    title: "AI Transformation at a Private Equity Portfolio Company",
    summary:
      "Turned real work into real results — giving teams the tools, skills, and guardrails to make AI a measurable advantage rather than a training exercise.",
    headline: "40% measured improvement",
  },
  {
    slug: "story-cellars",
    client: "Story Cellars",
    industry: "Consumer Products",
    tag: "Marketing",
    title: "Story Cellars and Synozur — Craft and Culture",
    summary:
      "Opened up new ways of thinking and developing customer relationships for a craft winery founded in 2016 by Tim Oas.",
    headline: "New ways of building customer relationships",
  },
  {
    slug: "go‑to‑market-transformation-for-a-microsoft‑aligned-software-company",
    client: "US Enterprise Software Company",
    industry: "Enterprise Software",
    tag: "Marketing",
    title: "Go-to-Market Transformation for a Software Company",
    summary:
      "Clarified go-to-market strategy and sharpened messaging for a Microsoft-aligned software company — telling a clearer story that resonates with customers and partners.",
    headline: "A clearer story for customers and partners",
  },
];

const QUOTES = [
  {
    text: "Synozur's impact through this project has truly revolutionized how our employees interact and collaborate, positioning us for greater innovation and success.",
    attribution: "Vice President of Digital Collaboration",
    metrics: [
      { value: "$2.0M–$6.0M", label: "Annual productivity gains" },
      { value: "12,000+", label: "Employees reached" },
    ],
    slug: "energy-company-reinvents-employee-expereince-and-effectiveness",
  },
  {
    text: "The team finally had a shared way to plan, measure, and adjust together — instead of reinventing the playbook every quarter.",
    attribution: "Product Marketing Group leader, Microsoft Modern Work",
    metrics: [
      { value: "$0.5M–$1.0M", label: "Cost avoidance" },
      { value: ">100%", label: "OKR revenue growth" },
    ],
    slug: "transforming-management-frameworks-at-microsoft",
  },
  {
    text: "This wasn't just training — it was transformation. Synozur helped us turn real work into real results, giving our teams the tools, skills, and guardrails to make AI matter.",
    attribution: "Chief Operating Officer",
    metrics: [
      { value: "40%", label: "Measured improvement" },
      { value: "Guardrails", label: "AI used with confidence" },
    ],
    slug: "ai-transformation-at-a-private-equity-portfolio-company",
  },
];

const OUTCOMES = [
  { icon: TrendingUp, value: "$3M–$12M", label: "Incremental revenue, GTM transformation" },
  { icon: Users, value: "12,000+", label: "Employees reached across programs" },
  { icon: Sparkles, value: ">100%", label: "OKR revenue growth on key goals" },
  { icon: ShieldCheck, value: "40%", label: "Measured improvement, AI transformation" },
];

const INDUSTRY_FILTERS = [
  "All",
  "Technology",
  "Energy",
  "Private Equity",
  "Software",
  "Consumer Products",
];
const SERVICE_FILTERS = ["All", "Strategy", "AI", "Employee Effectiveness", "Marketing"];

function FilterRow({ label, options, active }: { label: string; options: string[]; active: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <span className="text-xs uppercase tracking-widest text-muted-foreground sm:w-24 shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const isActive = o === active;
          return (
            <button
              key={o}
              type="button"
              className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:border-primary/50 hover:text-primary"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProofPanel({ c, index }: { c: ProofCase; index: number }) {
  return (
    <motion.article
      {...fadeUp}
      className="rounded-3xl border border-border/60 bg-card overflow-hidden nebula-card"
    >
      <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
        {/* Narrative column */}
        <div className="p-8 md:p-12 lg:[direction:ltr]">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
              {c.archetype}
            </span>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Anchor case {String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <h3 className="text-2xl md:text-3xl font-bold mb-6">{c.client}</h3>

          <div className="space-y-5">
            <div className="rounded-2xl border border-border/50 bg-background/40 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Before
              </p>
              <p className="text-[15px] leading-relaxed text-muted-foreground">{c.before}</p>
            </div>
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">
                After
              </p>
              <p className="text-[15px] leading-relaxed text-foreground">{c.after}</p>
            </div>
          </div>
        </div>

        {/* Evidence column over a sky image */}
        <div className="relative p-8 md:p-12 lg:[direction:ltr] overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img src={c.image} alt="" className="w-full h-full object-cover opacity-20" />
            <div className="absolute inset-0 bg-card/85" />
          </div>
          <div className="relative z-10">
            <div className="mb-7 rounded-2xl border border-border/50 bg-background/50 backdrop-blur-sm p-5">
              <div className="text-3xl font-bold text-primary mb-1">{c.metric.value}</div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {c.metric.label}
              </div>
            </div>

            <p className="text-xs font-semibold uppercase tracking-widest text-foreground/80 mb-3">
              Impact
            </p>
            <ul className="space-y-2.5 mb-7">
              {c.impact.map((it) => (
                <li key={it} className="flex gap-2.5 text-[15px] leading-snug">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>

            <p className="text-xs font-semibold uppercase tracking-widest text-foreground/80 mb-3">
              What changed
            </p>
            <ul className="space-y-2.5">
              {c.changed.map((it) => (
                <li key={it} className="flex gap-2.5 text-[15px] leading-snug text-muted-foreground">
                  <CircleDot className="h-4 w-4 text-primary/70 shrink-0 mt-1" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>

            <Link
              href={`/case-studies/${c.slug}`}
              className="mt-7 inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              Read the full case study <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export default function Proof() {
  return (
    <div className="w-full overflow-x-hidden selection:bg-primary/30">
      <Meta
        title="Proof — Outcomes We Can Prove — The Synozur Alliance"
        rawTitle
        description="Anchor cases in Before / After / Impact form — from a Microsoft engagement to AI transformation in private equity. Measurable outcomes, not promises."
        path="/proof"
        image="/og/og-proof.jpg"
      />

      {/* 1. Hero over a North Star sky */}
      <section className="relative min-h-[600px] flex items-center overflow-hidden bg-[#0B0B1A]">
        <div className="absolute inset-0 z-0">
          <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-55" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0B0B1A]/40 via-[#0B0B1A]/55 to-[#0B0B1A]" />
          <div className="absolute inset-0 nebula-gradient opacity-15 mix-blend-screen" />
        </div>
        <div className="container relative z-10 mx-auto px-4 md:px-6 pt-28 pb-20 max-w-4xl">
          <motion.p {...fadeUp} className="text-sm uppercase tracking-[0.25em] text-primary mb-5">
            Proof, not promises
          </motion.p>
          <motion.h1
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.05 }}
            className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 leading-[1.05]"
          >
            Outcomes we can <span className="nebula-text">prove</span>.
          </motion.h1>
          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.1 }}
            className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl"
          >
            We drive impactful change through strategy and craft. Each anchor case below shows the
            same arc — where a team started, where they landed, and the measurable difference in
            between. Many more engagements are available under NDA.
          </motion.p>
          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.15 }}
            className="mt-9 flex flex-wrap gap-4"
          >
            <a
              href="#proof-stack"
              className="h-12 px-7 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-base font-medium transition-colors hover:bg-primary/90"
            >
              See the proof <ArrowRight className="ml-2 h-4 w-4" />
            </a>
            <a
              href="#contact"
              className="h-12 px-7 inline-flex items-center justify-center rounded-md border border-white/25 bg-white/5 text-white text-base font-medium backdrop-blur-md transition-colors hover:bg-white/10"
            >
              Request case material
            </a>
          </motion.div>
        </div>
      </section>

      {/* 2. Quantified outcomes band over a sky image */}
      <section className="relative overflow-hidden border-y border-border">
        <div className="absolute inset-0 z-0">
          <img src={SKY.coast} alt="" className="w-full h-full object-cover opacity-25" />
          <div className="absolute inset-0 bg-background/85" />
        </div>
        <div className="container relative z-10 mx-auto px-4 md:px-6 py-20">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {OUTCOMES.map((o, i) => {
              const Icon = o.icon;
              return (
                <motion.div
                  key={o.label}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: i * 0.07 }}
                  className="text-center"
                >
                  <div className="mx-auto mb-4 h-12 w-12 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-3xl md:text-4xl font-bold text-white mb-2">{o.value}</div>
                  <div className="text-sm text-muted-foreground leading-snug max-w-[14rem] mx-auto">
                    {o.label}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. The Proof Stack — anchor cases in Before / After / Impact form */}
      <section id="proof-stack" className="py-24 bg-background">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mb-12">
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">The Proof Stack</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Five anchor cases. One repeatable arc.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              From a recognizable Microsoft engagement to high-stakes AI transformation in private
              equity, each case follows the same path: a clear starting point, a structured shift,
              and outcomes we can attribute.
            </p>
          </div>

          <div className="space-y-8">
            {PROOF_STACK.map((c, i) => (
              <ProofPanel key={c.slug} c={c} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* 4. Client quotes — social proof */}
      <section className="relative overflow-hidden py-24 bg-card border-y border-border">
        <div className="absolute inset-0 z-0">
          <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-15" />
          <div className="absolute inset-0 bg-card/80" />
        </div>
        <div className="container relative z-10 mx-auto px-4 md:px-6">
          <div className="mb-12 text-center">
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">In their words</p>
            <h2 className="text-3xl md:text-4xl font-bold">What our clients say</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {QUOTES.map((q, i) => (
              <motion.div
                key={i}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.07 }}
                className="flex flex-col rounded-2xl border border-border/60 bg-background/60 backdrop-blur-sm p-8"
              >
                <Quote className="h-7 w-7 text-primary/60 mb-4" aria-hidden="true" />
                <blockquote className="text-lg leading-relaxed flex-1">"{q.text}"</blockquote>
                <figcaption className="mt-5 text-sm font-semibold text-muted-foreground">
                  — {q.attribution}
                </figcaption>
                <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-border/60 pt-5">
                  {q.metrics.map((m, j) => (
                    <div key={j}>
                      <dt className="text-2xl font-bold text-primary">{m.value}</dt>
                      <dd className="text-xs uppercase tracking-wide text-muted-foreground">
                        {m.label}
                      </dd>
                    </div>
                  ))}
                </dl>
                <Link
                  href={`/case-studies/${q.slug}`}
                  className="mt-6 inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  Read the case study <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. The full library — filterable grid */}
      <section id="cases" className="py-24 bg-background">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-3xl mb-12">
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">The full library</p>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">More case studies</h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              A few more of the engagements we are able to share publicly — many more are available
              under NDA. Filter by industry or service to find what is most relevant.
            </p>
          </div>

          <div className="mb-12 space-y-5">
            <FilterRow label="Industry" options={INDUSTRY_FILTERS} active="All" />
            <FilterRow label="Service" options={SERVICE_FILTERS} active="All" />
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
              <p className="text-sm text-muted-foreground">Showing 5 of 5 case studies</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {STUDIES.map((s, i) => (
              <motion.article
                key={s.slug}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: (i % 3) * 0.06 }}
                className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors nebula-card"
              >
                <Link href={`/case-studies/${s.slug}`} className="block">
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <img
                      src={SKY_CYCLE[i % SKY_CYCLE.length]}
                      alt={s.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-6 flex items-center gap-2">
                      <span className="inline-block py-1 px-3 rounded-full bg-white/15 border border-white/25 text-white text-xs font-medium backdrop-blur-md">
                        {s.industry}
                      </span>
                      <span className="inline-block py-1 px-3 rounded-full bg-primary/30 border border-primary/40 text-white text-xs font-medium backdrop-blur-md">
                        {s.tag}
                      </span>
                    </div>
                  </div>
                  <div className="p-7">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                      {s.client}
                    </p>
                    <h3 className="text-xl font-bold mb-3 leading-snug group-hover:text-primary transition-colors">
                      {s.title}
                    </h3>
                    <p className="text-muted-foreground mb-6 leading-relaxed line-clamp-3">
                      {s.summary}
                    </p>
                    <div className="flex items-center justify-between pt-4 border-t border-border/50">
                      <span className="text-sm font-semibold text-primary leading-tight pr-3">
                        {s.headline}
                      </span>
                      <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary shrink-0">
                        Read
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* 6. CTA band over sky image */}
      <section id="contact" className="relative overflow-hidden border-t border-border py-28">
        <div className="absolute inset-0 z-0">
          <img src={SKY.people} alt="" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-background/80" />
          <div className="absolute inset-0 nebula-gradient opacity-15 mix-blend-screen" />
        </div>
        <div className="container relative z-10 mx-auto px-4 md:px-6 text-center max-w-2xl">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">Curious about a specific industry?</h2>
          <p className="text-lg md:text-xl text-zinc-300 mb-9">
            We share more detailed case material under NDA. Tell us what you are working on and we
            will send what is most relevant.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Request case material <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
