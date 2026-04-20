import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Compass, Cpu, Sparkles, TrendingUp } from "lucide-react";

const pillars = [
  {
    slug: "strategic-transformation",
    icon: Compass,
    name: "Strategic Transformation",
    summary:
      "Set direction, align leadership, and translate ambition into the operating cadence required to reach it.",
    solutions: [
      "Company OS",
      "Fractional Leadership",
      "Delivery Management",
      "Strategic Roadmaps",
      "AI Strategy & Design",
    ],
  },
  {
    slug: "technology-transformation",
    icon: Cpu,
    name: "Technology Transformation",
    summary:
      "Modernize the platforms, data, and AI capabilities that quietly determine how fast your strategy can move.",
    solutions: ["AI Strategy & Design", "Microsoft Partner Development"],
  },
  {
    slug: "experiences",
    icon: Sparkles,
    name: "Experiences",
    summary:
      "Design the moments — for employees and customers — where strategy is felt, judged, and either lived or lost.",
    solutions: [
      "Employee Effectiveness",
      "Employee Strategies",
      "Communication Strategies",
      "Design Strategies",
    ],
  },
  {
    slug: "go-to-market-transformation",
    icon: TrendingUp,
    name: "Go-to-Market Transformation",
    summary:
      "Sharpen brand, message, and motion so the market understands — and chooses — what you have built.",
    solutions: ["Brand & Messaging", "GTM Strategy & Execution"],
  },
];

export default function ServicesOverview() {
  return (
    <div className="w-full">
      <Meta
        title="Services Overview"
        description="Four service pillars built to power transformation that is rooted in people, powered by technology, and driven by purpose."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Our Services
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-8">
            Four pillars. One destination.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            Every engagement is shaped from the same set of disciplines. We compose
            them around your situation — never the other way around.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 space-y-8">
          {pillars.map((p, i) => (
            <motion.div
              key={p.slug}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
            >
              <Link
                href={`/services/${p.slug}`}
                className="group block rounded-2xl border border-border/60 bg-card p-8 md:p-12 hover:border-primary/40 hover:bg-card/80 transition-all"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  <div className="lg:col-span-1">
                    <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <p.icon className="h-7 w-7" />
                    </div>
                  </div>
                  <div className="lg:col-span-7">
                    <h2 className="text-2xl md:text-3xl font-bold mb-3 group-hover:text-primary transition-colors">
                      {p.name}
                    </h2>
                    <p className="text-lg text-muted-foreground leading-relaxed">
                      {p.summary}
                    </p>
                  </div>
                  <div className="lg:col-span-4">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                      Solutions
                    </p>
                    <ul className="space-y-2">
                      {p.solutions.map((s) => (
                        <li
                          key={s}
                          className="text-sm text-foreground/90 flex items-center gap-2"
                        >
                          <span className="h-1 w-1 rounded-full bg-primary" />
                          {s}
                        </li>
                      ))}
                    </ul>
                    <span className="mt-6 inline-flex items-center text-sm font-semibold text-primary">
                      Explore pillar
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
