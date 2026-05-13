import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Linkedin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${BASE_PATH}${url}`;
  return url;
}

function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Team() {
  const { data: people = [], isLoading } = useQuery({
    queryKey: ["public-team-members"],
    queryFn: () => api.publicTeamMembers(),
  });

  return (
    <div className="w-full">
      <Meta
        title="Our Team"
        description="The leaders behind The Synozur Alliance — partners drawn from across the Fortune 500."
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-32">
        <div className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-widest text-primary mb-4">
            Our Team
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
            Operators who became advisors.
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl">
            At Synozur, we specialize in guiding organizations toward success
            through tailored solutions that optimize performance and maximize
            growth. Our partners sit alongside your team — not above it.
          </p>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <p className="text-sm uppercase tracking-widest text-primary mb-3">
            Team Members
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-12">Leadership</h2>
          {isLoading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8"
              data-testid="team-grid"
            >
              {people.map((p, i) => {
                const bio = stripHtml(p.shortDescription);
                const imageSrc = resolveImageUrl(p.imageUrl);
                return (
                  <motion.article
                    key={p.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.45, delay: i * 0.05 }}
                    className="group"
                    data-testid={`team-card-${p.slug}`}
                  >
                    <Link
                      href={`/team/${encodeURIComponent(p.slug)}`}
                      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
                    >
                      <div className="relative aspect-square rounded-2xl overflow-hidden bg-card mb-5 border border-border/50">
                        {imageSrc ? (
                          <img
                            src={imageSrc}
                            alt={p.name}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                            {p.name}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                      </div>
                      <h3 className="text-lg font-bold leading-tight group-hover:text-primary transition-colors">
                        {p.name}
                      </h3>
                      <p className="text-sm text-primary mb-3">{p.jobTitle}</p>
                      {bio && (
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                          {bio}
                        </p>
                      )}
                    </Link>
                    {p.linkedinUrl && (
                      <a
                        href={p.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                        aria-label={`${p.name} on LinkedIn`}
                      >
                        <Linkedin className="h-4 w-4" /> LinkedIn
                      </a>
                    )}
                  </motion.article>
                );
              })}
            </div>
          )}
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
