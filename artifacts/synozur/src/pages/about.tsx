import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Compass, Heart, Sparkles, Telescope } from "lucide-react";

const values = [
  {
    icon: Compass,
    title: "Direction over motion",
    body: "Movement without a fixed point is drift. We help leaders define the destination first, then build the route.",
  },
  {
    icon: Heart,
    title: "People at the center",
    body: "Transformation is a human act. Strategies that ignore the lived experience of teams quietly fail in execution.",
  },
  {
    icon: Sparkles,
    title: "Craft as discipline",
    body: "We treat strategy, design, and delivery as one continuous craft — measured by outcomes, not deliverables.",
  },
  {
    icon: Telescope,
    title: "Long horizons",
    body: "We optimize for the decade ahead, not the quarter — and translate that horizon into work that ships now.",
  },
];

export default function About() {
  return (
    <div className="w-full">
      <Meta
        title="Our Story"
        description="The Synozur Alliance is named for the North Star. We guide organizations through transformation rooted in people, powered by technology, and driven by purpose."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-30" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-8"
          >
            Named for the <span className="nebula-text">North Star</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="text-xl md:text-2xl text-zinc-300 leading-relaxed"
          >
            Synozur is drawn from the ancient Greek for the celestial point sailors
            relied on to find their way. It is the promise we make to every client we
            serve.
          </motion.p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-5"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
              An advisory firm built by operators
            </h2>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="lg:col-span-7 space-y-6 text-lg text-muted-foreground leading-relaxed"
          >
            <p>
              Synozur was founded by leaders from across the Fortune 500 who believed
              the consulting playbook was overdue for reinvention. Decks alone do not
              change companies. Frameworks alone do not move markets. What does is the
              hard, careful work of aligning strategy, technology, and people around a
              destination worth reaching.
            </p>
            <p>
              We assemble small, senior teams that sit alongside our clients — operating
              partners, not observers — translating ambition into execution. Our work
              spans transformation strategy, technology modernization, employee and
              customer experiences, and the go-to-market motion that turns capability
              into growth.
            </p>
            <p>
              Whether you are stewarding a public company through reinvention, building
              the next category-defining product, or modernizing a generational
              institution, Synozur is built to walk the journey with you.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-16">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              What we believe
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">Our principles</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {values.map((v, i) => (
              <motion.div
                key={v.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-xl border border-border/60 bg-background/50 p-8 hover:border-primary/40 transition-colors"
              >
                <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6">
                  <v.icon className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold mb-3">{v.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{v.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Meet the people behind the firm
          </h2>
          <p className="text-lg text-muted-foreground mb-10">
            Our partners have led transformation at some of the most recognizable
            companies in the world. Now they bring that experience to yours.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/team"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Meet the team <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-card px-8 text-base font-medium text-foreground transition-colors hover:bg-muted"
            >
              Talk with us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
