import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

const studies = [
  {
    industry: "Financial Services",
    title: "Re-architecting decision-making at a global insurer",
    summary:
      "Designed a Company OS connecting the executive team's strategic priorities to weekly operational decisions across twelve business units.",
    metric: "↓ 38% time to executive decision",
  },
  {
    industry: "Healthcare",
    title: "An AI maturity program that earned board confidence",
    summary:
      "Replaced a sprawl of disconnected pilots with a governed AI portfolio tied to clinical and operational outcomes.",
    metric: "$42M projected three-year value",
  },
  {
    industry: "Industrial",
    title: "Modernizing a generational manufacturer",
    summary:
      "Rebuilt the digital backbone — data, platforms, and operating model — to support the next decade of growth.",
    metric: "11 legacy platforms retired",
  },
  {
    industry: "Enterprise SaaS",
    title: "Repositioning a category leader for the next horizon",
    summary:
      "Sharpened narrative and rebuilt the GTM motion ahead of a category expansion that doubled the addressable market.",
    metric: "2.4× pipeline within two quarters",
  },
  {
    industry: "Public Sector",
    title: "An employee experience overhaul that actually shipped",
    summary:
      "Redesigned the daily tooling and rituals for 18,000 frontline employees, anchored to measurable productivity outcomes.",
    metric: "↑ 22% engagement, ↑ 14% throughput",
  },
  {
    industry: "Consumer",
    title: "From four brands to one operating system",
    summary:
      "Consolidated brand, design, and operating models across acquired companies into a single, durable platform.",
    metric: "Single design system, four markets",
  },
];

const palettes = [
  "from-indigo-700 via-purple-700 to-fuchsia-700",
  "from-blue-700 via-indigo-800 to-purple-900",
  "from-fuchsia-700 via-purple-800 to-indigo-900",
  "from-purple-700 via-violet-700 to-blue-700",
  "from-indigo-800 via-blue-800 to-purple-700",
  "from-violet-700 via-fuchsia-800 to-rose-700",
];

export default function CaseStudies() {
  return (
    <div className="w-full">
      <Meta
        title="Case Studies"
        description="Selected stories of transformation. The strategies, the work, and the outcomes."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Our Projects
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Selected case studies
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            A small sample of the work we have shipped with our clients. Many
            engagements are not public — we are happy to share more in a private
            conversation.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {studies.map((s, i) => (
              <motion.article
                key={s.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors"
              >
                <div
                  className={`relative aspect-[4/3] bg-gradient-to-br ${palettes[i % palettes.length]} overflow-hidden`}
                >
                  <div className="absolute inset-0 nebula-gradient opacity-30 mix-blend-overlay" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4),transparent_60%)]" />
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <span className="inline-block py-1 px-3 rounded-full bg-white/15 border border-white/25 text-white text-xs font-medium backdrop-blur-md">
                      {s.industry}
                    </span>
                  </div>
                </div>
                <div className="p-7">
                  <h2 className="text-xl font-bold mb-3 leading-snug group-hover:text-primary transition-colors">
                    {s.title}
                  </h2>
                  <p className="text-muted-foreground mb-6 leading-relaxed">
                    {s.summary}
                  </p>
                  <div className="flex items-center justify-between pt-4 border-t border-border/50">
                    <span className="text-sm font-semibold text-primary">
                      {s.metric}
                    </span>
                    <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary">
                      Read <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-card border-t border-border py-24">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Curious about a specific industry?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            We share more detailed case material under NDA. Tell us what you are
            working on and we will send what is most relevant.
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
