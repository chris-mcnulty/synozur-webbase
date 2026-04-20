import { Meta } from "@/lib/meta";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import {
  getApplicationBySlug,
  getActiveApplications,
} from "@/data/applications";
import NotFound from "@/pages/not-found";

export default function ApplicationDetail() {
  const [, params] = useRoute("/applications/:slug");
  const slug = params?.slug;
  const app = slug ? getApplicationBySlug(slug) : undefined;

  if (!app) {
    return <NotFound />;
  }

  const others = getActiveApplications()
    .filter((a) => a.slug !== app.slug)
    .slice(0, 3);

  const releaseLabel = new Date(app.releaseDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="w-full">
      <Meta title={app.name} description={app.tagline} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-20">
        <div className="absolute inset-0 nebula-gradient opacity-15" />
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <Link
            href="/applications"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All applications
          </Link>
          <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8">
            <div className="h-20 w-20 rounded-xl overflow-hidden bg-white/5 border border-white/10 shrink-0">
              <img
                src={app.logo}
                alt={`${app.name} logo`}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                {app.version && (
                  <span className="inline-block py-1 px-3 rounded-full bg-primary/20 border border-primary/30 text-white text-xs font-medium backdrop-blur-sm">
                    v{app.version}
                  </span>
                )}
                <span className="text-xs uppercase tracking-widest text-zinc-400">
                  Released {releaseLabel}
                </span>
              </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white">
                {app.name}
              </h1>
            </div>
          </div>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl mb-8">
            {app.tagline}
          </p>
          <a
            href={app.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            data-testid="app-primary-cta"
          >
            Visit {app.name}
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Screenshot */}
      <section className="bg-background">
        <div className="container mx-auto px-4 max-w-5xl -mt-12 relative z-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl overflow-hidden border border-border shadow-2xl bg-card"
          >
            <img
              src={app.screenshot}
              alt={`${app.name} screenshot`}
              className="w-full h-auto object-cover"
            />
          </motion.div>
        </div>
      </section>

      {/* Description */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 max-w-3xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-3">
            About {app.name}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-8">
            What it does
          </h2>
          <div className="space-y-5 text-lg text-muted-foreground leading-relaxed">
            {app.description.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="mt-12 pt-8 border-t border-border/60">
            <a
              href={app.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Open {app.name}
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* Other applications */}
      {others.length > 0 && (
        <section className="py-20 bg-card border-t border-border">
          <div className="container mx-auto px-4 max-w-5xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              More from Synozur
            </p>
            <h2 className="text-2xl md:text-3xl font-bold mb-10">
              Explore other applications
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={`/applications/${o.slug}`}
                  className="group rounded-2xl border border-border/60 bg-background p-6 hover:border-primary/40 transition-colors block"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-lg overflow-hidden bg-card border border-border shrink-0">
                      <img
                        src={o.logo}
                        alt={`${o.name} logo`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <h3 className="text-lg font-bold group-hover:text-primary transition-colors">
                      {o.name}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 mb-4">
                    {o.shortSummary}
                  </p>
                  <span className="inline-flex items-center text-sm text-muted-foreground group-hover:text-primary">
                    Learn more
                    <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
