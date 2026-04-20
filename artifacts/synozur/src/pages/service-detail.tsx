import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link, useRoute } from "wouter";
import { ArrowRight, Check, Compass, Cpu, Sparkles, TrendingUp } from "lucide-react";
import NotFound from "./not-found";

type Pillar = {
  slug: string;
  name: string;
  tagline: string;
  intro: string;
  icon: typeof Compass;
  solutions: { name: string; body: string }[];
  outcomes: string[];
  approach: { title: string; body: string }[];
};

const pillars: Record<string, Pillar> = {
  "strategic-transformation": {
    slug: "strategic-transformation",
    name: "Strategic Transformation",
    tagline: "Set the destination. Align the leadership. Build the cadence.",
    intro:
      "Strategy is only useful when an organization can actually live it. We work alongside executive teams to clarify the destination, codify how decisions get made, and install the operating rhythm that turns intent into momentum.",
    icon: Compass,
    solutions: [
      {
        name: "Company OS",
        body: "Connect strategy to execution with a shared operating model — objectives, metrics, rituals, and decision rights working as one system.",
      },
      {
        name: "Fractional Leadership",
        body: "Senior partners stepping into Chief of Staff, COO, or transformation lead roles for the duration the work demands — and not a quarter longer.",
      },
      {
        name: "Delivery Management",
        body: "We stand up the program office that turns ambitious roadmaps into shippable, accountable, on-time outcomes.",
      },
      {
        name: "Strategic Roadmaps",
        body: "12, 24, and 36-month roadmaps grounded in capability reality — sequenced so each milestone earns the right to the next.",
      },
      {
        name: "AI Strategy & Design",
        body: "Decide where AI creates durable advantage, where it doesn't, and what your organization must change to capture it.",
      },
    ],
    outcomes: [
      "A leadership team aligned on the next horizon and the route to reach it",
      "An operating cadence that surfaces risk early and reallocates capital quickly",
      "Decision rights and accountability that hold up under pressure",
    ],
    approach: [
      {
        title: "Diagnose",
        body: "We map the strategy you have today against the one your market actually requires — and find the gap.",
      },
      {
        title: "Design",
        body: "We co-design the operating model, roadmap, and rituals with the leaders who will run them.",
      },
      {
        title: "Deliver",
        body: "We embed alongside your team to ship the first 90 days of work and transfer the muscle as we go.",
      },
    ],
  },
  "technology-transformation": {
    slug: "technology-transformation",
    name: "Technology Transformation",
    tagline: "Modernize the platforms that quietly govern how fast you can move.",
    intro:
      "Technology decisions made years ago set the speed limit on every strategy you run today. We help leaders rethink those decisions — modernizing platforms, data, and AI capabilities so the next decade of work can actually be built.",
    icon: Cpu,
    solutions: [
      {
        name: "AI Strategy & Design",
        body: "From use-case discovery through model selection, governance, and operating model — we design AI programs built to compound.",
      },
      {
        name: "Microsoft Partner Development",
        body: "Decades of experience helping organizations get the most from the Microsoft ecosystem — and helping Microsoft partners build the right offers on top of it.",
      },
    ],
    outcomes: [
      "A platform strategy that aligns to where your business is going, not where it has been",
      "AI capabilities that are governed, measurable, and adopted by the people who need them",
      "A clear partner roadmap with Microsoft and the broader ecosystem",
    ],
    approach: [
      {
        title: "Assess",
        body: "We benchmark your current technology, data, and AI maturity against the demands of your strategy.",
      },
      {
        title: "Architect",
        body: "We design the target architecture, partner posture, and investment plan that gets you there responsibly.",
      },
      {
        title: "Activate",
        body: "We help your teams build, govern, and adopt — with the operating model to keep it running.",
      },
    ],
  },
  experiences: {
    slug: "experiences",
    name: "Experiences",
    tagline: "Design the moments where strategy is actually lived.",
    intro:
      "Every strategy ultimately becomes an experience — for an employee opening a tool on Monday morning or a customer making a buying decision under pressure. Synozur designs those moments so they reinforce, rather than betray, the work behind them.",
    icon: Sparkles,
    solutions: [
      {
        name: "Employee Effectiveness",
        body: "Tools, workflows, and rituals that let your people do their best work — measurably.",
      },
      {
        name: "Employee Strategies",
        body: "Talent, organization design, and culture work calibrated to the strategy you are actually trying to run.",
      },
      {
        name: "Communication Strategies",
        body: "Internal narratives that travel — clear enough to align, specific enough to act on.",
      },
      {
        name: "Design Strategies",
        body: "Design systems, brand expression, and product surfaces that turn intent into something people can feel.",
      },
    ],
    outcomes: [
      "Employees who experience the strategy in their day, not in a deck",
      "Customers who recognize the brand at every touchpoint, in voice and craft",
      "Design and communication systems that scale with the organization",
    ],
    approach: [
      {
        title: "Listen",
        body: "We start where the experience actually lives — with the people who use it every day.",
      },
      {
        title: "Design",
        body: "We design the systems, narratives, and surfaces that make the strategy concrete.",
      },
      {
        title: "Embed",
        body: "We hand off with documentation, rituals, and ownership that outlast our engagement.",
      },
    ],
  },
  "go-to-market-transformation": {
    slug: "go-to-market-transformation",
    name: "Go-to-Market Transformation",
    tagline: "Turn capability into category leadership.",
    intro:
      "Great products and great strategies still need a market that understands them. We help leaders sharpen positioning, rebuild the motion, and align marketing, sales, and product into a go-to-market that earns share.",
    icon: TrendingUp,
    solutions: [
      {
        name: "Brand & Messaging",
        body: "Positioning, narrative, and messaging architecture that the whole company can operate against.",
      },
      {
        name: "GTM Strategy & Execution",
        body: "Segmentation, pricing, motion design, and the operating model to run them — built and shipped together.",
      },
    ],
    outcomes: [
      "Positioning the entire company can repeat from memory",
      "A go-to-market motion measured by pipeline created, not slides produced",
      "Marketing, sales, and product operating from the same source of truth",
    ],
    approach: [
      {
        title: "Sharpen",
        body: "We pressure-test positioning against the market your strategy actually needs to win.",
      },
      {
        title: "Sequence",
        body: "We design the motion: ideal customer, channel mix, message ladder, pricing, and proof.",
      },
      {
        title: "Ship",
        body: "We help the GTM org execute — and we measure the work the way the market does.",
      },
    ],
  },
};

export default function ServiceDetail() {
  const [, params] = useRoute("/services/:slug");
  const slug = params?.slug ?? "";
  const pillar = pillars[slug];

  if (!pillar) return <NotFound />;

  const Icon = pillar.icon;

  return (
    <div className="w-full">
      <Meta
        title={pillar.name}
        description={pillar.tagline}
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <Link
            href="/services-overview/default"
            className="text-sm text-zinc-400 hover:text-white inline-flex items-center mb-8"
          >
            ← All Services
          </Link>
          <div className="h-16 w-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center mb-8">
            <Icon className="h-8 w-8" />
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            {pillar.name}
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed">
            {pillar.tagline}
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-xl text-muted-foreground leading-relaxed">
            {pillar.intro}
          </p>
        </div>
      </section>

      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-12">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Solutions
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              What's included
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {pillar.solutions.map((s, i) => (
              <motion.div
                key={s.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="rounded-xl border border-border/60 bg-background/50 p-8"
              >
                <h3 className="text-lg font-bold mb-3">{s.name}</h3>
                <p className="text-muted-foreground leading-relaxed">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div>
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Outcomes
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-8">
              What you walk away with
            </h2>
            <ul className="space-y-4">
              {pillar.outcomes.map((o) => (
                <li key={o} className="flex items-start gap-3 text-lg">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-foreground/90">{o}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Approach
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-8">How we work</h2>
            <ol className="space-y-6">
              {pillar.approach.map((step, i) => (
                <li key={step.title} className="flex gap-5">
                  <span className="text-2xl font-bold text-primary tabular-nums shrink-0 w-8">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-lg font-bold mb-1">{step.title}</h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-card border-t border-border py-24">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to start a conversation about {pillar.name.toLowerCase()}?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Tell us where you are headed. We will tell you where we can help.
          </p>
          <Link
            href="/start"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Get Started <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
