import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Calendar, ChevronDown, ChevronUp, Linkedin, Mail, Globe, Mic2 } from "lucide-react";
import { api } from "@/lib/api";
import NotFound from "@/pages/not-found";
import { RichText } from "@/components/rich-text";
import { PersonJsonLd } from "@/components/person-jsonld";
import { EditWedge } from "@/components/edit-wedge";
import { dynamicOgImageUrl } from "@/lib/og-image-url";

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

function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:")) {
    return url.trim();
  }
  return undefined;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

type RecentPost = {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  heroImageUrl?: string | null;
  publishedAt?: string | null;
  categories?: { id: string; slug: string; name: string }[];
};

type RecentEvent = {
  id: number;
  slug: string;
  title: string;
  startDate: string | Date;
  location?: string | null;
  teaser?: string | null;
  imageUrl?: string | null;
  status?: string;
};

function RecentEventsRail({
  events,
  name,
}: {
  events: RecentEvent[];
  name: string;
}) {
  const [pastOpen, setPastOpen] = useState(false);
  if (!events.length) return null;

  const now = Date.now();
  const upcoming = events
    .filter((e) => {
      const ms = new Date(e.startDate).getTime();
      return Number.isFinite(ms) && ms >= now;
    })
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  const past = events
    .filter((e) => {
      const ms = new Date(e.startDate).getTime();
      return !Number.isFinite(ms) || ms < now;
    })
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  const firstName = name.split(" ")[0];
  const heading = upcoming.length > 0 ? `${firstName} is speaking at` : `${firstName} has spoken at`;

  return (
    <section className="py-20 bg-card border-t border-border">
      <div className="container mx-auto px-4 max-w-5xl">
        <p className="text-sm uppercase tracking-widest text-primary mb-3">
          On Stage
        </p>
        <div className="flex items-center justify-between mb-10 gap-4 flex-wrap">
          <h2 className="text-2xl md:text-3xl font-bold">{heading}</h2>
          <Link
            href="/events"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            All events <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {upcoming.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {upcoming.map((e) => (
              <EventCard key={e.id} event={e} label="Upcoming" />
            ))}
          </div>
        )}

        {past.length > 0 && (
          <div className={upcoming.length > 0 ? "mt-10" : ""}>
            <button
              onClick={() => setPastOpen((o) => !o)}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group"
            >
              {pastOpen ? (
                <ChevronUp className="h-4 w-4 text-primary" />
              ) : (
                <ChevronDown className="h-4 w-4 text-primary" />
              )}
              {pastOpen
                ? "Hide past events"
                : `Show ${past.length} past event${past.length !== 1 ? "s" : ""}`}
            </button>
            {pastOpen && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {past.map((e) => (
                  <EventCard key={e.id} event={e} label="Past" />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function EventCard({ event: e, label }: { event: RecentEvent; label: string }) {
  const image = resolveImageUrl(e.imageUrl);
  return (
    <Link
      href={`/events/${e.slug}`}
      className="group rounded-2xl border border-border/60 bg-background overflow-hidden hover:border-primary/40 transition-colors block"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-muted/20">
        {image ? (
          <img
            src={image}
            alt={e.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full nebula-gradient opacity-30 flex items-center justify-center">
            <Calendar className="h-8 w-8 text-white/70" />
          </div>
        )}
      </div>
      <div className="p-5">
        <p className="text-xs uppercase tracking-widest text-primary mb-2">{label}</p>
        <h3 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors mb-2">
          {e.title}
        </h3>
        <p className="text-xs text-muted-foreground">
          {formatDate(
            typeof e.startDate === "string"
              ? e.startDate
              : e.startDate.toISOString(),
          )}
          {e.location ? ` · ${e.location}` : ""}
        </p>
      </div>
    </Link>
  );
}

function RecentPostsRail({ posts, name }: { posts: RecentPost[]; name: string }) {
  if (!posts.length) return null;
  return (
    <section className="py-20 bg-background border-t border-border">
      <div className="container mx-auto px-4 max-w-5xl">
        <p className="text-sm uppercase tracking-widest text-primary mb-3">
          From the Feed
        </p>
        <div className="flex items-center justify-between mb-10 gap-4 flex-wrap">
          <h2 className="text-2xl md:text-3xl font-bold">
            Recent posts by {name.split(" ")[0]}
          </h2>
          <Link
            href="/insights"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            All insights <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((p) => {
            const hero = resolveImageUrl(p.heroImageUrl);
            return (
              <Link
                key={p.id}
                href={`/insights/${p.slug}`}
                className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors block"
              >
                <div className="relative aspect-[16/9] overflow-hidden bg-muted/20">
                  {hero ? (
                    <img
                      src={hero}
                      alt={p.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full nebula-gradient opacity-30" />
                  )}
                </div>
                <div className="p-5">
                  {p.categories?.[0] && (
                    <p className="text-xs uppercase tracking-widest text-primary mb-2">
                      {p.categories[0].name}
                    </p>
                  )}
                  <h3 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors mb-2">
                    {p.title}
                  </h3>
                  {p.excerpt && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{stripHtml(p.excerpt)}</p>
                  )}
                  {p.publishedAt && (
                    <p className="text-xs text-muted-foreground mt-3">{formatDate(p.publishedAt)}</p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
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

  if (detailQ.isError) {
    const isNotFound =
      detailQ.error instanceof Error && /404/.test(detailQ.error.message);
    if (isNotFound) return <NotFound />;
    return (
      <div className="w-full py-32 text-center text-muted-foreground">
        Something went wrong. Please try again later.
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

  const enriched = person as {
    recentPosts?: RecentPost[];
    recentEvents?: RecentEvent[];
    updatedAt?: string | Date | null;
  };
  const recentPosts = enriched.recentPosts ?? [];
  const recentEvents = enriched.recentEvents ?? [];
  // Use the editor-set headshot when present (LinkedIn / Slack accept any
  // aspect ratio); fall back to the dynamic 1200×630 brand template so
  // members without a photo still unfurl cleanly.
  const ogImage =
    imageSrc ?? dynamicOgImageUrl("team-member", person.id, enriched.updatedAt);

  return (
    <div className="w-full">
      <Meta
        title={person.name}
        description={metaDescription}
        image={ogImage ?? undefined}
        type="article"
      />
      <PersonJsonLd
        slug={person.slug}
        name={person.name}
        jobTitle={person.jobTitle}
        description={metaDescription}
        image={imageSrc ?? null}
        email={person.email ?? null}
        linkedinUrl={person.linkedinUrl ?? null}
        website={person.website ?? null}
      />

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
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-white/5 border border-white/10">
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    alt={person.name}
                    className="w-full h-full object-contain"
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
                <RichText
                  html={person.shortDescription}
                  className="text-xl text-zinc-300 leading-relaxed mb-8 [&_p]:mb-4 [&_strong]:text-white"
                  invert
                />
              )}
              <div className="flex flex-wrap gap-3">
                {safeHref(person.linkedinUrl) && (
                  <a
                    href={safeHref(person.linkedinUrl)}
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
                {safeHref(person.website) &&
                  !/^https?:\/\/(www\.)?wix\.com\/?$/i.test(person.website ?? "") && (
                    <a
                      href={safeHref(person.website)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/20 text-sm text-white hover:bg-white/10 transition-colors"
                    >
                      <Globe className="h-4 w-4" /> Website
                    </a>
                  )}
                {safeHref(person.speakerBookingUrl) && (
                  <a
                    href={safeHref(person.speakerBookingUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Mic2 className="h-4 w-4" /> Book {person.name.split(" ")[0]}
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
            <RichText
              html={person.longDescription}
              className="prose-lg text-lg text-muted-foreground leading-relaxed [&_p]:mb-5"
            />
          </div>
        </section>
      )}

      <RecentEventsRail events={recentEvents} name={person.name} />

      <RecentPostsRail posts={recentPosts} name={person.name} />

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

      <EditWedge
        kind="team-member"
        id={person.id}
        slug={person.slug}
        snapshot={person}
        queryKey={["public-team-members", slug, "detail"]}
      />
    </div>
  );
}
