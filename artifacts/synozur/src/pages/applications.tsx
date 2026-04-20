import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, ExternalLink } from "lucide-react";
import { getActiveApplications } from "@/data/applications";

export default function Applications() {
  const apps = getActiveApplications();

  return (
    <div className="w-full">
      <Meta
        title="Applications"
        description="Synozur's portfolio of AI-powered applications — Vega, Nebula, Constellation, Orion, Orbit, Zenith, and more."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Our Applications
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            A constellation of products
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            Purpose-built platforms that turn Synozur's frameworks, research,
            and advisory experience into software your teams can use every day.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {apps.map((app, i) => (
              <motion.article
                key={app.slug}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors flex flex-col"
                data-testid={`app-card-${app.slug}`}
              >
                <Link
                  href={`/applications/${app.slug}`}
                  className="block aspect-[16/10] overflow-hidden bg-[#0B0B1A]"
                >
                  <img
                    src={app.screenshot}
                    alt={`${app.name} screenshot`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                </Link>
                <div className="p-7 flex-1 flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-12 w-12 rounded-lg overflow-hidden bg-card border border-border shrink-0">
                      <img
                        src={app.logo}
                        alt={`${app.name} logo`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold leading-snug group-hover:text-primary transition-colors">
                        {app.name}
                      </h2>
                      {app.version && (
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">
                          v{app.version}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-medium text-primary mb-3">
                    {app.tagline}
                  </p>
                  <p className="text-muted-foreground mb-6 leading-relaxed text-sm flex-1">
                    {app.shortSummary}
                  </p>
                  <div className="flex items-center justify-between pt-4 border-t border-border/50 gap-3">
                    <Link
                      href={`/applications/${app.slug}`}
                      className="text-sm font-semibold text-foreground hover:text-primary inline-flex items-center"
                      data-testid={`app-learn-more-${app.slug}`}
                    >
                      Learn more
                      <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                    <a
                      href={app.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-primary inline-flex items-center"
                      data-testid={`app-open-${app.slug}`}
                    >
                      Open
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </a>
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
            Want to see one in action?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Each Synozur application is built on the same frameworks our
            advisors use with clients. Tell us what you're working on and we'll
            point you to the right one.
          </p>
          <Link
            href="/contact"
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Talk to us <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
