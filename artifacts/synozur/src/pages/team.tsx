import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Linkedin } from "lucide-react";

const people = [
  { name: "Alexandra Mehta", title: "Managing Partner", bio: "Two decades leading enterprise transformation at Fortune 100 financial institutions.", initials: "AM" },
  { name: "Daniel Okafor", title: "Partner, Strategy", bio: "Former Chief Strategy Officer at a top-five global consultancy. Operates where strategy meets execution.", initials: "DO" },
  { name: "Sofia Lindqvist", title: "Partner, Technology", bio: "Built and scaled engineering organizations across cloud, data, and AI for two decades.", initials: "SL" },
  { name: "Marcus Chen", title: "Partner, Experiences", bio: "Award-winning design leader who has shaped products used by hundreds of millions.", initials: "MC" },
  { name: "Priya Iyer", title: "Partner, Go-to-Market", bio: "Previously CMO at a category-defining enterprise SaaS company.", initials: "PI" },
  { name: "Elena Rivera", title: "Partner, AI", bio: "AI program leader and former research director with a focus on responsible deployment.", initials: "ER" },
  { name: "Jonathan Park", title: "Partner, Microsoft Practice", bio: "Two decades inside and around Microsoft, helping partners build durable businesses.", initials: "JP" },
  { name: "Amara Adeyemi", title: "Partner, Delivery", bio: "Stands up the program offices that make ambitious roadmaps actually ship.", initials: "AA" },
];

const palettes = [
  "from-indigo-700 to-purple-700",
  "from-purple-700 to-fuchsia-700",
  "from-blue-700 to-indigo-800",
  "from-fuchsia-700 to-purple-800",
  "from-violet-700 to-blue-700",
  "from-indigo-800 to-purple-700",
  "from-purple-800 to-rose-700",
  "from-blue-800 to-violet-800",
];

export default function Team() {
  return (
    <div className="w-full">
      <Meta
        title="Team"
        description="The leaders behind The Synozur Alliance — partners drawn from across the Fortune 500."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Leadership
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Operators who became advisors.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            Our partners have led transformation from inside the companies our
            clients aspire to be. They sit alongside your team, not above it.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {people.map((p, i) => (
              <motion.article
                key={p.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.05 }}
                className="group"
              >
                <div
                  className={`relative aspect-[4/5] rounded-2xl overflow-hidden bg-gradient-to-br ${palettes[i % palettes.length]} mb-5`}
                >
                  <div className="absolute inset-0 nebula-gradient opacity-30 mix-blend-overlay" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-6xl font-bold text-white/90 tracking-tight">
                      {p.initials}
                    </span>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                </div>
                <h3 className="text-lg font-bold leading-tight">{p.name}</h3>
                <p className="text-sm text-primary mb-3">{p.title}</p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {p.bio}
                </p>
                <a
                  href="#"
                  className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                  aria-label={`${p.name} on LinkedIn`}
                >
                  <Linkedin className="h-4 w-4" /> LinkedIn
                </a>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-card border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            We are hiring senior practitioners.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            If you are a former operator who wants to do consulting differently — small
            teams, senior work, real outcomes — we should talk.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Get in touch
          </Link>
        </div>
      </section>
    </div>
  );
}
