import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Linkedin, Mail, Globe } from "lucide-react";
import { api } from "@/lib/api";
import NotFound from "@/pages/not-found";

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

export default function TeamDetail() {
  const [, params] = useRoute("/team/:slug");
  const slug = params?.slug ?? "";

  const detailQ = useQuery({
    queryKey: ["public-team-members", slug, "detail"],
    queryFn: () => api.publicTeamMember(slug),
    enabled: slug.length > 0,
    retry: (count, err) => {
      if (err instanceof Error && /404/.test(err.message)) return false;
      return count < 2;
    },
  });

  const listQ = useQuery({
    queryKey: ["public-team-members"],
    queryFn: () => api.publicTeamMembers(),
  });

  if (detailQ.isLoading) {
    return (
      <div className="w-full py-32 text-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  const person = detailQ.data;
  if (!person) {
    return <NotFound />;
  }

  const imageSrc = resolveImageUrl(person.imageUrl);
  const metaDescription =
    stripHtml(person.shortDescription) ||
    `${person.name} — ${person.jobTitle} at Synozur.`;
  const others = (listQ.data ?? [])
    .filter((p) => p.slug !== person.slug)
    .slice(0, 3);

  return (
    <div className="w-full">
      <Meta title={person.name} description={metaDescription} />

      <section className="relative overflow-hidden bg-[#0B0B1A] pt-24 pb-20">
        <div className="absolute inset-0 nebula-gradient opacity-20" />
        <div className="container relative z-10 mx-auto px-4 max-w-5xl">
          <Link
            href="/team"
            className="inline-flex items-center text-sm text-zinc-300 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> All team members
          </Link>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-10 items-start">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="md:col-span-2"
            >
              <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-white/5 border border-white/10">
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    alt={person.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">
                    {person.name}
                  </div>
                )}
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="md:col-span-3"
            >
              <p className="text-sm uppercase tracking-widest text-primary mb-3">
                {person.jobTitle}
              </p>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6">
                {person.name}
              </h1>
              {person.shortDescription && (
                <div
                  className="text-xl text-zinc-300 leading-relaxed mb-8 [&_p]:mb-4 [&_strong]:text-white"
                  dangerouslySetInnerHTML={{ __html: person.shortDescription }}
                />
              )}
              <div className="flex flex-wrap gap-3">
                {person.linkedinUrl && (
                  <a
                    href={person.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/20 text-sm text-white hover:bg-white/10 transition-colors"
                  >
                    <Linkedin className="h-4 w-4" /> LinkedIn
                  </a>
                )}
                {person.email && (
                  <a
                    href={`mailto:${person.email}`}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/20 text-sm text-white hover:bg-white/10 transition-colors"
                  >
                    <Mail className="h-4 w-4" /> Email
                  </a>
                )}
                {person.website &&
                  !/^https?:\/\/(www\.)?wix\.com\/?$/i.test(person.website) && (
                    <a
                      href={person.website}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/20 text-sm text-white hover:bg-white/10 transition-colors"
                    >
                      <Globe className="h-4 w-4" /> Website
                    </a>
                  )}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {person.longDescription && (
        <section className="py-20 bg-background">
          <div className="container mx-auto px-4 max-w-3xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              About {person.name.split(" ")[0]}
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-8">Biography</h2>
            <div
              className="prose prose-lg max-w-none text-lg text-muted-foreground leading-relaxed [&_p]:mb-5 [&_strong]:text-foreground [&_a]:text-primary [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: person.longDescription }}
            />
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="py-20 bg-card border-t border-border">
          <div className="container mx-auto px-4 max-w-5xl">
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              More from Synozur
            </p>
            <h2 className="text-2xl md:text-3xl font-bold mb-10">
              Meet other team members
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {others.map((o) => {
                const otherImg = resolveImageUrl(o.imageUrl);
                return (
                  <Link
                    key={o.slug}
                    href={`/team/${encodeURIComponent(o.slug)}`}
                    className="group rounded-2xl border border-border/60 bg-background overflow-hidden hover:border-primary/40 transition-colors block"
                  >
                    <div className="aspect-[4/5] bg-card overflow-hidden">
                      {otherImg ? (
                        <img
                          src={otherImg}
                          alt={o.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                          {o.name}
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="text-lg font-bold group-hover:text-primary transition-colors">
                        {o.name}
                      </h3>
                      <p className="text-sm text-primary">{o.jobTitle}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
