import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

const articles = [
  { category: "AI", date: "Apr 2026", title: "The honest case for slowing your AI roadmap", excerpt: "Most enterprise AI programs are over-funded and under-governed. A measured rebalance creates more value than another pilot.", image: "/images/insight-1.png" },
  { category: "Strategy", date: "Mar 2026", title: "Operating cadence is the underrated strategic asset", excerpt: "The companies that out-execute their strategy do not have better plans. They have better weeks.", image: "/images/insight-2.png" },
  { category: "Leadership", date: "Mar 2026", title: "Why fractional leadership is finally entering the executive suite", excerpt: "Senior, time-boxed leadership is changing how transformation gets staffed inside the Fortune 500.", image: "/images/insight-3.png" },
  { category: "Technology", date: "Feb 2026", title: "Modernization without theater", excerpt: "How to retire legacy platforms in a way the board can defend and the engineering team can actually deliver.", image: "/images/insight-4.png" },
  { category: "Experiences", date: "Feb 2026", title: "Designing for the Monday morning experience", excerpt: "A simple test for whether your strategy will survive contact with the people expected to live it.", image: "/images/insight-5.png" },
  { category: "Go-to-Market", date: "Jan 2026", title: "Repositioning is a leadership decision, not a marketing exercise", excerpt: "When the market reframes your category, the response begins in the executive team — not the brand brief.", image: "/images/insight-6.png" },
  { category: "AI", date: "Jan 2026", title: "What the AI Maturity Model is actually measuring", excerpt: "A guided tour of the model and how leaders use it to set their next investment cycle.", image: "/images/insight-7.png" },
  { category: "Strategy", date: "Dec 2025", title: "The Company OS, in plain language", excerpt: "Why we keep coming back to the operating model — and what it actually contains.", image: "/images/insight-8.png" },
  { category: "Leadership", date: "Dec 2025", title: "Decision rights are the deliverable", excerpt: "Most transformation programs ship artifacts. The ones that change companies ship clarity.", image: "/images/insight-9.png" },
];

const categories = ["All", "AI", "Strategy", "Technology", "Experiences", "Leadership", "Go-to-Market"];

export default function Insights() {
  const [active, setActive] = useState("All");
  const filtered = active === "All" ? articles : articles.filter((a) => a.category === active);

  return (
    <div className="w-full">
      <Meta
        title="Insights"
        description="The Feed. Original writing on transformation, technology, leadership, and the operating disciplines that let strategy actually ship."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">The Feed</p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Insights
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            Original writing from our partners on transformation, technology,
            leadership, and the operating disciplines that let strategy ship.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-wrap gap-2 mb-12">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActive(c)}
                className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                  active === c
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filtered.map((a, i) => (
              <motion.article
                key={a.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.04 }}
                className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors"
              >
                <div className="relative aspect-[16/9] overflow-hidden bg-card">
                  <img
                    src={a.image}
                    alt={a.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground mb-3">
                    <span className="text-primary">{a.category}</span>
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                    <span>{a.date}</span>
                  </div>
                  <h2 className="text-lg font-bold leading-snug mb-3 group-hover:text-primary transition-colors">
                    {a.title}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                    {a.excerpt}
                  </p>
                  <span className="inline-flex items-center text-sm font-medium text-primary">
                    Read <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-card border-t border-border py-24">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Subscribe to The Feed</h2>
          <p className="text-lg text-muted-foreground mb-6">
            New essays, models, and Polaris episodes — delivered to your inbox.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Subscribe
          </Link>
        </div>
      </section>
    </div>
  );
}
