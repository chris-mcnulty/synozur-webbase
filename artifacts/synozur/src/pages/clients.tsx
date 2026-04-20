import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Quote } from "lucide-react";
import { caseStudies } from "@/data/case-studies";
import { clientLogos, partnerLogos, rotatorLogos, type LogoEntry } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";

const quotes = [
  {
    quote:
      "Our journey with the Company Operating System has truly transformed the way we operate and lead. The clear focus on priorities and performance metrics have empowered us to make strategic decisions more effectively.",
    name: "Senior leader",
    org: "North American luxury manufacturer",
  },
  {
    quote:
      "Synozur's impact through this project has truly revolutionized how our employees interact and collaborate, positioning us for greater innovation and success.",
    name: "Vice President of Digital Collaboration",
    org: "North American Energy Company",
  },
  {
    quote:
      "The team finally had a shared way to plan, measure, and adjust together — instead of reinventing the playbook every quarter.",
    name: "Product Marketing Group leader",
    org: "Microsoft Modern Work",
  },
];

function LogoCell({ entry }: { entry: LogoEntry }) {
  const inner = (
    <div className="bg-white aspect-[5/3] flex items-center justify-center px-6 py-5 transition-colors group-hover:bg-zinc-50">
      <img
        src={entry.src}
        alt={`${entry.name} logo`}
        loading="lazy"
        className="max-h-16 md:max-h-20 max-w-[85%] w-auto h-auto object-contain"
      />
    </div>
  );
  return entry.href ? (
    <a href={entry.href} className="group block" aria-label={entry.name}>
      {inner}
    </a>
  ) : (
    <div className="group" aria-label={entry.name}>
      {inner}
    </div>
  );
}

export default function Clients() {
  return (
    <div className="w-full">
      <Meta
        title="Our Clients"
        description="Synozur partners with global enterprises and breakout growth companies. With years of experience working with global customers across various industries, we have the insights to tackle complex challenges and drive meaningful change."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Our Clients
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Global experience and deep expertise.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            With years of experience working with global customers across various
            industries, we have the insights to tackle complex challenges and
            drive meaningful change.
          </p>
        </div>
      </section>

      {/* Logo rotator */}
      <section className="py-12 md:py-16 bg-card border-b border-border">
        <div className="container mx-auto px-4">
          <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-6">
            Trusted by
          </p>
          <LogoRotator logos={rotatorLogos} />
        </div>
      </section>

      {/* Clients */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-10">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Clients
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Selected client engagements
            </h2>
            <p className="text-muted-foreground mt-4">
              Most of our clients prefer not to be named publicly. The named work below
              has been published with their permission — see our case studies for the
              full story.
            </p>
          </div>
          <div className="max-w-md mx-auto">
            <div className="rounded-xl overflow-hidden border border-border">
              {clientLogos.map((logo, i) => (
                <motion.div
                  key={logo.name}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.04 }}
                >
                  <LogoCell entry={logo} />
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Case Studies preview */}
      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
            <div className="max-w-2xl">
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                Case studies
              </p>
              <h2 className="text-3xl md:text-4xl font-bold">
                The work, in their words
              </h2>
            </div>
            <Link
              href="/case-studies"
              className="inline-flex items-center text-sm font-medium border border-border rounded-md px-4 py-2 hover:bg-muted transition-colors shrink-0"
            >
              View all case studies <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {caseStudies.map((s) => (
              <Link
                key={s.slug}
                href={`/case-studies/${s.slug}`}
                className="group rounded-2xl border border-border/60 bg-background overflow-hidden hover:border-primary/40 transition-colors block"
              >
                <div className="aspect-[16/9] overflow-hidden">
                  <img
                    src={s.heroImage}
                    alt={s.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-6">
                  <p className="text-xs uppercase tracking-widest text-primary mb-2">
                    {s.industry}
                  </p>
                  <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors leading-snug">
                    {s.title}
                  </h3>
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {s.summary}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Partners */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-10">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Alliance Implementation & ISV Partners
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              The partner network
            </h2>
            <p className="text-muted-foreground mt-4">
              We deliver alongside a curated network of implementation partners and
              ISVs — anchored in our Microsoft practice.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden border border-border">
            {partnerLogos.map((logo, i) => (
              <motion.div
                key={logo.name}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.03 }}
              >
                <LogoCell entry={logo} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Quotes */}
      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="max-w-2xl mb-16">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              In their words
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              What our clients tell us
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {quotes.map((q, i) => (
              <motion.figure
                key={q.org}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-xl border border-border/60 bg-background/50 p-8 flex flex-col"
              >
                <Quote className="h-7 w-7 text-primary mb-6" />
                <blockquote className="text-base md:text-lg text-foreground/90 leading-relaxed mb-6 flex-1">
                  "{q.quote}"
                </blockquote>
                <figcaption>
                  <p className="font-semibold text-foreground">{q.name}</p>
                  <p className="text-sm text-muted-foreground">{q.org}</p>
                </figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            See the work in detail
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Our case studies tell the story of how transformation actually unfolds —
            including the parts most firms leave out.
          </p>
          <Link
            href="/case-studies"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            View Case Studies <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
