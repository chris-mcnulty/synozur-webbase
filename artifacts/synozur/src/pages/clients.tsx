import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Quote } from "lucide-react";

const logos = [
  "Northwind",
  "Contoso",
  "Fabrikam",
  "Trey Research",
  "Adventure Works",
  "Lucerne Publishing",
  "Litware",
  "Tailspin Toys",
  "Wide World",
  "Wingtip",
  "Proseware",
  "Margie's Travel",
];

const quotes = [
  {
    quote:
      "Synozur did not arrive with a deck. They arrived with a point of view, sat with our team for a week, and left with a roadmap our board immediately approved.",
    name: "Chief Strategy Officer",
    org: "Fortune 100 financial services",
  },
  {
    quote:
      "The clearest, most operationally honest assessment of our AI program we have ever received. They told us what to stop doing as forcefully as what to start.",
    name: "Chief Information Officer",
    org: "Fortune 500 manufacturer",
  },
  {
    quote:
      "They felt like part of the leadership team within a month. The transition out felt like a member of the family moving on, not a vendor closing an SOW.",
    name: "Chief Executive Officer",
    org: "Series D enterprise SaaS",
  },
];

export default function Clients() {
  return (
    <div className="w-full">
      <Meta
        title="Clients"
        description="Synozur partners with Fortune 500 enterprises and category-defining growth companies on the work that matters most."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Clients
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            The companies we walk beside.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            From Fortune 100 institutions to the breakout companies redefining their
            categories, our clients share one trait — they are willing to be honest
            about where they are, and ambitious about where they are going.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden border border-border">
            {logos.map((logo, i) => (
              <motion.div
                key={logo}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.03 }}
                className="bg-card aspect-[3/2] flex items-center justify-center px-6"
              >
                <span className="text-lg md:text-xl font-semibold tracking-tight text-foreground/70">
                  {logo}
                </span>
              </motion.div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground text-center mt-6">
            Representative engagements. Many of our clients prefer not to be named.
          </p>
        </div>
      </section>

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
                key={q.name}
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
