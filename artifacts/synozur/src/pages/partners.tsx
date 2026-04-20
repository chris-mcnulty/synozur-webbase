import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Building2, Network, Sparkles } from "lucide-react";

const programs = [
  {
    icon: Building2,
    title: "Microsoft Partner Development",
    body:
      "We help organizations get the most from the Microsoft ecosystem — and help Microsoft partners build durable businesses on top of it. Strategy, offers, GTM, and field enablement.",
  },
  {
    icon: Network,
    title: "Ecosystem Alliances",
    body:
      "We work alongside hyperscalers, ISVs, and systems integrators where the engagement calls for it — composing the right team rather than defending a single stack.",
  },
  {
    icon: Sparkles,
    title: "Boutique Specialists",
    body:
      "When a problem demands deep specialization — design, AI research, change management — we partner with the small firms doing the most interesting work in those areas.",
  },
];

export default function Partners() {
  return (
    <div className="w-full">
      <Meta
        title="Partners"
        description="The Synozur Alliance partners with the Microsoft ecosystem, hyperscalers, and specialist boutiques to assemble the right team for each engagement."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Partners
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            We compose the right team for the work.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            Synozur is built around alliances. We bring our partners in deliberately —
            so each engagement gets the depth it actually needs, not the depth we
            happen to sell.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
          {programs.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="rounded-2xl border border-border/60 bg-card p-8 hover:border-primary/40 transition-colors"
            >
              <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6">
                <p.icon className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">{p.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden bg-card border-y border-border py-24">
        <div className="absolute inset-0 nebula-gradient opacity-10" />
        <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Interested in partnering?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            We are deliberate about who we work with. If our practices line up with
            your roadmap, we would like to hear from you.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Reach the partner team <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
