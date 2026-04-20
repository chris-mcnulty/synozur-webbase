import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Play } from "lucide-react";

const episodes = [
  { num: "06", title: "Operating cadence in a 100,000-person company", guest: "CSO, Global Industrial", length: "47 min" },
  { num: "05", title: "Why responsible AI is finally a board topic", guest: "CIO, Healthcare Network", length: "52 min" },
  { num: "04", title: "Designing the Monday morning experience", guest: "Chief People Officer, Tech", length: "39 min" },
  { num: "03", title: "Repositioning a category leader", guest: "CEO, Enterprise SaaS", length: "44 min" },
  { num: "02", title: "Fractional leadership in the executive suite", guest: "Operating Partner, PE", length: "41 min" },
  { num: "01", title: "Finding your North Star", guest: "Synozur Founders", length: "55 min" },
];

const palettes = [
  "from-fuchsia-700 to-indigo-900",
  "from-purple-700 to-violet-900",
  "from-blue-700 to-purple-800",
  "from-indigo-700 to-fuchsia-700",
  "from-violet-700 to-blue-800",
  "from-purple-800 to-indigo-700",
];

export default function Polaris() {
  return (
    <div className="w-full">
      <Meta
        title="Polaris Podcast"
        description="Polaris is a podcast about transformation — strategy, technology, leadership, and the operating work that turns ambition into outcome."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-30" />
        <div className="container relative z-10 mx-auto px-4 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <p className="text-sm uppercase tracking-widest text-primary mb-4">
              Polaris
            </p>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
              The Polaris Podcast
            </h1>
            <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-2xl">
              Long-form conversations with the operators behind real transformation.
              Hosted by the partners of The Synozur Alliance.
            </p>
          </div>
          <div className="lg:col-span-5">
            <div className="relative aspect-square rounded-3xl overflow-hidden bg-gradient-to-br from-violet-700 via-fuchsia-700 to-indigo-900 shadow-2xl">
              <div className="absolute inset-0 nebula-gradient opacity-40 mix-blend-overlay" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.45),transparent_60%)]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-7xl font-bold tracking-tighter text-white/95">
                  POLARIS
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mb-12">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Episodes
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">Latest conversations</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {episodes.map((e, i) => (
              <motion.article
                key={e.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors"
              >
                <div className={`relative aspect-square bg-gradient-to-br ${palettes[i % palettes.length]}`}>
                  <div className="absolute inset-0 nebula-gradient opacity-30 mix-blend-overlay" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.4),transparent_60%)]" />
                  <div className="absolute top-5 left-5 text-white/80 text-xs uppercase tracking-widest">
                    Episode {e.num}
                  </div>
                  <div className="absolute bottom-5 right-5">
                    <button
                      className="h-14 w-14 rounded-full bg-white/95 text-[#0B0B1A] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform"
                      aria-label={`Play episode ${e.num}`}
                    >
                      <Play className="h-5 w-5 ml-0.5 fill-current" />
                    </button>
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="text-lg font-bold leading-snug mb-2 group-hover:text-primary transition-colors">
                    {e.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    With {e.guest}
                  </p>
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    {e.length}
                  </span>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-card border-t border-border py-20">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Polaris is available wherever you listen.
          </h2>
          <p className="text-muted-foreground">
            Apple Podcasts · Spotify · YouTube · RSS
          </p>
        </div>
      </section>
    </div>
  );
}
