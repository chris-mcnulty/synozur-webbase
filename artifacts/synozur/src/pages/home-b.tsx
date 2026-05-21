import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Building2, Globe, Star } from "lucide-react";
import { api } from "@/lib/api";
import { clientLogos } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";
import { workshopsApi, type WorkshopDto } from "@/lib/api-workshops";
import { Skeleton } from "@/components/ui/skeleton";
import { FromTheFeedCarousel, HomeShortcuts } from "@/pages/home";
import { HomeConfigWedge } from "@/components/home-config-wedge";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO_BG = "/images/hero-bg.png";
const BUNDLED_HERO_VIDEO_WEBM = `${BASE_PATH}/videos/hero-bg.webm`;
const BUNDLED_HERO_VIDEO_MP4 = `${BASE_PATH}/videos/hero-bg.mp4`;

function resolveImageUrl(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  if (url.startsWith("/api/")) return `${BASE_PATH}${url}`;
  return url;
}

// #215: Default editorial copy. Each piece is overridable via Site Settings →
// "Alt home page (/home-b) copy"; the page falls back to these when the
// matching `homeB*` field on the public site settings is null/empty.
const DEFAULTS = {
  heroHeadlinePrefix: "The",
  heroHeadlineAccent: "Transformation",
  heroHeadlineSuffix: "Company",
  heroSubheadline:
    "Real tools. Documented models. Tested methods. Built for executives who need to move — not just plan.",
  pillarsEyebrow: "How we work",
  pillarsHeadline: "A disciplined approach. Not a methodology deck.",
  closingEyebrow: "Ready to begin",
  closingHeadline: "Every engagement starts with a real conversation.",
  closingBody:
    "If you're navigating a market shift, an AI transformation, or a leadership reorganization — we'd like to understand it with you. Not pitch to you.",
  workshopsHeadline: "The decision that ends the drift.",
  workshopsBody:
    "Most leadership teams leave offsites with notes. Synozur workshops end with a named owner, a committed decision, and a next step that's already in motion. One day. Real stakes. No deck to take home and translate.",
} as const;

const PILLARS = [
  {
    headline: "Clarity before motion.",
    body: "Competing priorities stall organizations, not missing ideas. Every Synozur engagement starts with a diagnostic — so decisions are grounded in what's actually true.",
    proofLabel: "See our assessment approach",
    proofHref: "/applications/orion",
  },
  {
    headline: "IP that's built, not borrowed.",
    body: "Our models aren't recycled frameworks. They're built from specific problems, tested with real clients, and documented enough to use again.",
    proofLabel: "Explore our models",
    proofHref: "/models",
  },
  {
    headline: "Strategy lives in execution.",
    body: "Plans that stay in decks don't transform organizations. Vega makes strategy trackable — connecting decisions to outcomes so leaders can see what's moving and what isn't.",
    proofLabel: "Explore Vega",
    proofHref: "/applications/vega",
  },
  {
    headline: "Outcomes are the only measure.",
    body: "We define success in concrete terms from the start. Case studies are proof, not decoration — each one documents what changed and what was built.",
    proofLabel: "See client work",
    proofHref: "/case-studies",
  },
];

// Trim & null-out empty strings so an admin clearing a field falls back to the
// hard-coded default rather than rendering a blank line.
function override(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

// #214: Per-slug presentation overlays for /home-b's software cards. The
// applications API drives the set, ordering, names, taglines, and
// descriptions — these entries only contribute the editorial bits that
// aren't part of an application record (the inside/outside lens framing
// and a fallback copy block used if the API is unreachable on first
// paint). Any slug *not* in this map will render with a neutral
// "Internal" lens default.
type LensKey = "inside" | "outside";

const SOFTWARE_PRESENTATION: Record<
  string,
  {
    lens: LensKey;
    lensLabel: string;
    fallbackName: string;
    fallbackTagline: string;
    fallbackDescription: string;
  }
> = {
  orion: {
    lens: "inside",
    lensLabel: "Internal Assessment",
    fallbackName: "Orion",
    fallbackTagline: "Where every engagement begins.",
    fallbackDescription:
      "Orion is Synozur's organizational diagnostic platform. It surfaces the signals that matter inside your organization — helping leadership teams align around a shared picture of current-state reality before committing to strategy.",
  },
  vega: {
    lens: "inside",
    lensLabel: "Internal Execution",
    fallbackName: "Vega",
    fallbackTagline: "Strategy made trackable.",
    fallbackDescription:
      "Vega connects strategic decisions to measurable outcomes inside the organization. Leaders get a live view of how initiatives are advancing, where momentum is building, and where attention is needed — so strategy doesn't stay in the deck.",
  },
  orbit: {
    lens: "outside",
    lensLabel: "External Intelligence",
    fallbackName: "Orbit",
    fallbackTagline: "The market, made legible.",
    fallbackDescription:
      "Orbit surfaces outside-in intelligence — market signals, competitor moves, positioning dynamics, and go-to-market context. It gives Synozur clients a clear view of the landscape their strategy must navigate, not just the terrain inside their organization.",
  },
};

// Slugs we want to feature on /home-b. The API decides the *order*
// among these (via featured / featuredRank); this list only filters
// the broader application set down to the three "platform" cards.
const FEATURED_SOFTWARE_SLUGS = ["orion", "vega", "orbit"] as const;

export default function HomeB() {
  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
  });

  const { data: workshopsData, isLoading: workshopsLoading } = useQuery({
    queryKey: ["public-workshops"],
    queryFn: () => workshopsApi.listPublic(),
  });

  // #214: Pull live applications so the featured software cards reflect
  // current names, taglines, descriptions, AND ordering from the CMS.
  // Same query key as the header nav so React Query dedupes the request.
  // The API endpoint already orders by `featured` desc, then
  // `featuredRank` asc, then title — so simply preserving its order
  // here means changing rank in admin reorders the cards on /home-b
  // without a code change.
  const { data: applicationsData } = useQuery({
    queryKey: ["applications", "nav"],
    queryFn: () => api.listApplications(true),
    staleTime: 5 * 60 * 1000,
  });
  const apiApps = applicationsData?.items ?? [];
  const apiPositionBySlug = new Map(apiApps.map((a, i) => [a.slug, i]));

  // Always render all three featured slots. We sort the slugs by the
  // API's returned position (which already reflects featured /
  // featuredRank / title) so admin reordering takes effect, but
  // missing slugs still appear using their local fallback copy. Slugs
  // not present in the API response are pinned to the end in their
  // canonical declaration order so the layout stays stable.
  const cardSlugs: string[] = [...FEATURED_SOFTWARE_SLUGS]
    .map((slug, declIndex) => ({ slug, declIndex }))
    .sort((a, b) => {
      const aPos = apiPositionBySlug.get(a.slug);
      const bPos = apiPositionBySlug.get(b.slug);
      if (aPos === undefined && bPos === undefined) return a.declIndex - b.declIndex;
      if (aPos === undefined) return 1;
      if (bPos === undefined) return -1;
      return aPos - bPos;
    })
    .map((entry) => entry.slug);

  const softwareCards = cardSlugs.map((slug) => {
    const live = apiApps.find((a) => a.slug === slug);
    const presentation = SOFTWARE_PRESENTATION[slug];
    const lens: LensKey = presentation?.lens ?? "inside";
    const lensLabel = presentation?.lensLabel ?? "Internal";
    const name = live?.name?.trim() || presentation?.fallbackName || slug;
    const tagline =
      live?.tagline?.trim() || presentation?.fallbackTagline || "";
    const description =
      live?.shortSummary?.trim() ||
      presentation?.fallbackDescription ||
      "";
    return { slug, lens, lensLabel, name, tagline, description };
  });
  const allWorkshops: WorkshopDto[] = workshopsData?.items ?? [];
  const featuredWorkshop = allWorkshops[0] ?? null;
  const secondaryWorkshops = allWorkshops.slice(1, 3);

  // /home-b is allowed to diverge from the original homepage hero from the
  // admin CMS. Each `homeBHero*` field is null when the admin hasn't picked
  // an Alt Home-specific override, in which case we transparently fall back
  // to the original `homeHero*` field so the two pages stay in sync.
  const effectiveHeroImageUrl = settings?.homeBHeroImageUrl ?? settings?.homeHeroImageUrl;
  const effectiveHeroVideoUrl = settings?.homeBHeroVideoUrl ?? settings?.homeHeroVideoUrl;
  const effectiveHeroBgType =
    settings?.homeBHeroBackgroundType ?? settings?.homeHeroBackgroundType;

  const heroBg = resolveImageUrl(effectiveHeroImageUrl, DEFAULT_HERO_BG);
  const customVideoSrc = effectiveHeroVideoUrl
    ? resolveImageUrl(effectiveHeroVideoUrl, BUNDLED_HERO_VIDEO_MP4)
    : null;

  // #215: editable copy with falls-back-to-default semantics.
  const heroHeadlinePrefix = override(settings?.homeBHeroHeadlinePrefix, DEFAULTS.heroHeadlinePrefix);
  const heroHeadlineAccent = override(settings?.homeBHeroHeadlineAccent, DEFAULTS.heroHeadlineAccent);
  const heroHeadlineSuffix = override(settings?.homeBHeroHeadlineSuffix, DEFAULTS.heroHeadlineSuffix);
  const heroSubheadline = override(settings?.homeBHeroSubheadline, DEFAULTS.heroSubheadline);
  const pillarsEyebrow = override(settings?.homeBPillarsEyebrow, DEFAULTS.pillarsEyebrow);
  const pillarsHeadline = override(settings?.homeBPillarsHeadline, DEFAULTS.pillarsHeadline);
  const pillars = PILLARS.map((p, i) => {
    const idx = (i + 1) as 1 | 2 | 3 | 4;
    const hKey = `homeBPillar${idx}Headline` as const;
    const bKey = `homeBPillar${idx}Body` as const;
    return {
      ...p,
      headline: override(settings?.[hKey], p.headline),
      body: override(settings?.[bKey], p.body),
    };
  });
  const closingEyebrow = override(settings?.homeBClosingEyebrow, DEFAULTS.closingEyebrow);
  const closingHeadline = override(settings?.homeBClosingHeadline, DEFAULTS.closingHeadline);
  const closingBody = override(settings?.homeBClosingBody, DEFAULTS.closingBody);

  const reducedMotion = useReducedMotion();
  const [videoReady, setVideoReady] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoReady && videoRef.current) videoRef.current.load();
  }, [videoReady]);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const schedule = (cb: () => void) => setTimeout(cb, 0);
    if (!("IntersectionObserver" in window)) { schedule(() => setVideoReady(true)); return; }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) { schedule(() => setVideoReady(true)); observer.disconnect(); }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full">
      <Meta
        title="The Synozur Alliance — A System for Strategic Transformation"
        rawTitle
        description="Synozur is The Transformation Company. Built tools, models, and methods for executives leading complex change — from organizational assessment to market intelligence to execution."
        path="/home-b"
        image="/opengraph.jpg"
      />

      {/* ── Hero: two-column ── */}
      <section ref={heroRef} className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#0B0B1A]">
        <div className="absolute inset-0 z-0 opacity-60">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0B0B1A] z-10" />
          {effectiveHeroBgType === "video" && !reducedMotion ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              loop
              playsInline
              poster={heroBg}
              className="w-full h-full object-cover"
              data-decorative="true"
            >
              {videoReady && (
                customVideoSrc ? (
                  <source src={customVideoSrc} />
                ) : (
                  <>
                    <source src={BUNDLED_HERO_VIDEO_WEBM} type="video/webm" />
                    <source src={BUNDLED_HERO_VIDEO_MP4} type="video/mp4" />
                  </>
                )
              )}
              <img src={heroBg} alt="" className="w-full h-full object-cover" fetchPriority="high" />
            </video>
          ) : (
            <img src={heroBg} alt="" className="w-full h-full object-cover" fetchPriority="high" />
          )}
        </div>

        <div className="container relative z-10 mx-auto px-4 py-20 md:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">

            {/* Left: copy */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="lg:col-span-6"
            >
              <img
                src={`${BASE_PATH}/images/sa-logo-horizontal-white.png`}
                alt="The Synozur Alliance"
                className="h-28 md:h-32 w-auto mb-10"
                style={{ mixBlendMode: "screen" }}
                fetchPriority="high"
              />
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-8 leading-[1.06]">
                {heroHeadlinePrefix}{heroHeadlinePrefix ? " " : ""}
                <span className="nebula-text">{heroHeadlineAccent}</span>
                {heroHeadlineSuffix ? " " : ""}{heroHeadlineSuffix}
              </h1>
              <p className="text-xl md:text-2xl text-zinc-300 mb-10 max-w-xl leading-relaxed">
                {heroSubheadline}
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/start"
                  className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                >
                  Start a Conversation
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <Link
                  href="/library"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-white/20 bg-white/5 px-8 text-base font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/10"
                >
                  Explore the Library
                </Link>
              </div>
            </motion.div>

            {/* Right: live feed */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
              className="lg:col-span-6"
            >
              <FromTheFeedCarousel />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Trusted by ── */}
      <section className="py-14 bg-[hsl(240_35%_10%)] border-y border-border">
        <div className="container mx-auto px-4">
          <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-6">
            Trusted by
          </p>
          <LogoRotator logos={clientLogos} />
        </div>
      </section>

      {/* ── Pillars: shorter + proof links ── */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl mb-16"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">{pillarsEyebrow}</p>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">
              {pillarsHeadline}
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-12">
            {pillars.map((pillar, i) => (
              <motion.div
                key={pillar.headline}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.09 }}
                className="flex flex-col"
              >
                <div className="w-8 h-px bg-primary mb-5" />
                <h3 className="text-xl md:text-2xl font-bold mb-3 leading-snug">
                  {pillar.headline}
                </h3>
                <p className="text-muted-foreground leading-relaxed flex-1">{pillar.body}</p>
                <Link
                  href={pillar.proofHref}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm text-primary font-semibold hover:text-primary/80 transition-colors"
                >
                  {pillar.proofLabel} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platforms: corrected Orbit + inside/outside badges ── */}
      <section className="py-24 bg-[hsl(240_35%_8%)] border-y border-border">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">

            <motion.div
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="lg:sticky lg:top-32"
            >
              <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">
                Proprietary platforms
              </p>
              <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
                Built software, not just slides.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                Orion diagnoses where you actually are before any strategy is set. Vega makes
                that strategy visible and trackable inside the organization. Orbit reads the
                competitive landscape the strategy must navigate. Three jobs. Three tools. No overlap.
              </p>
              <div className="flex flex-col gap-2 mt-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
                    <Building2 className="h-3 w-3" /> Internal
                  </span>
                  <span>organizational clarity and execution</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary text-xs font-semibold">
                    <Globe className="h-3 w-3" /> External
                  </span>
                  <span>market intelligence and competitive context</span>
                </div>
              </div>
            </motion.div>

            <div className="flex flex-col gap-5">
              {softwareCards.map((app, i) => (
                <motion.div
                  key={app.slug}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="group relative rounded-2xl border border-border/60 bg-card p-7 hover-elevate transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-xl font-bold">{app.name}</h3>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        app.lens === "inside"
                          ? "bg-primary/10 border-primary/20 text-primary"
                          : "bg-secondary/10 border-secondary/20 text-secondary"
                      }`}>
                        {app.lens === "inside"
                          ? <Building2 className="h-2.5 w-2.5" />
                          : <Globe className="h-2.5 w-2.5" />
                        }
                        {app.lensLabel}
                      </span>
                    </div>
                    <Link
                      href={`/applications/${app.slug}`}
                      className="flex-shrink-0 h-8 w-8 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:border-primary transition-colors ml-3"
                      aria-label={`Learn about ${app.name}`}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
                    {app.tagline}
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{app.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Proof carousel: moved up, stronger framing ── */}
      <section className="py-24 bg-background border-b border-border">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-10"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">
              From the archive
            </p>
            <h2 className="text-2xl md:text-3xl font-bold max-w-2xl mb-3">
              Models, applications, case work, and documented thinking — built, not drafted.
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Every item here is something Synozur actually built or used with a client. Not opinion. Not frameworks borrowed from somewhere else.
            </p>
          </motion.div>
          <FromTheFeedCarousel />
        </div>
      </section>

      {/* ── Workshops: featured hero card + secondary row ── */}
      <section className="py-24 bg-[hsl(240_35%_8%)] border-b border-border">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl mb-12"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">Workshops</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-5 leading-tight">
              {DEFAULTS.workshopsHeadline}
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {DEFAULTS.workshopsBody}
            </p>
          </motion.div>

          {workshopsLoading ? (
            <div className="space-y-6">
              <Skeleton className="w-full rounded-2xl h-64" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Skeleton className="rounded-2xl h-40" />
                <Skeleton className="rounded-2xl h-40" />
              </div>
            </div>
          ) : !featuredWorkshop && !workshopsLoading ? (
            <div className="rounded-2xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">
              Workshop details coming soon. <Link href="/workshops" className="text-primary underline-offset-2 hover:underline">View all workshops →</Link>
            </div>
          ) : featuredWorkshop ? (
            <div className="space-y-5">
              {/* Featured workshop — dominant card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <Link href={`/workshops/${featuredWorkshop.slug}`} className="group block">
                  <div className="relative rounded-2xl overflow-hidden bg-card border border-border/60 hover-elevate">
                    <div className="relative aspect-[21/9] overflow-hidden">
                      <img
                        src={featuredWorkshop.heroImage}
                        alt={featuredWorkshop.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
                      <div className="absolute inset-0 flex flex-col justify-end p-8 md:p-12">
                        <p className="text-xs uppercase tracking-[0.2em] text-primary mb-3">
                          Featured workshop
                        </p>
                        <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 max-w-xl leading-tight group-hover:text-primary transition-colors">
                          {featuredWorkshop.title}
                        </h3>
                        <p className="text-white/70 text-base max-w-lg leading-relaxed hidden md:block">
                          {featuredWorkshop.shortDescription}
                        </p>
                        <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white group-hover:text-primary transition-colors">
                          Explore this workshop <ArrowRight className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>

              {/* Secondary workshops */}
              {secondaryWorkshops.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {secondaryWorkshops.map((workshop, i) => (
                    <motion.div
                      key={workshop.slug}
                      initial={{ opacity: 0, y: 16 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: i * 0.08 }}
                    >
                      <Link href={`/workshops/${workshop.slug}`} className="group block h-full">
                        <div className="flex h-full rounded-2xl border border-border/60 bg-card overflow-hidden hover-elevate">
                          <div className="relative w-40 flex-shrink-0 overflow-hidden bg-muted">
                            <img
                              src={workshop.heroImage}
                              alt={workshop.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                              loading="lazy"
                              decoding="async"
                            />
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/20" />
                          </div>
                          <div className="flex flex-col flex-1 p-5">
                            <h3 className="font-bold text-sm leading-snug mb-2 group-hover:text-primary transition-colors">
                              {workshop.title}
                            </h3>
                            <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                              {workshop.shortDescription}
                            </p>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-8">
            <Link
              href="/workshops"
              className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors"
            >
              See all workshops <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Find Your North Star — editorial interstitial ── */}
      <section className="py-24 bg-background border-b border-border">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

            {/* Image */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-square rounded-2xl overflow-hidden border border-border/50 shadow-2xl bg-card order-last lg:order-first"
            >
              <img
                src={resolveImageUrl(settings?.homeEditorialImageUrl, `${BASE_PATH}/images/home-hero-editorial.png`)}
                alt="A leader finding their North Star"
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-30 mix-blend-overlay" />
            </motion.div>

            {/* Copy */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-8">
                <Star className="h-7 w-7" />
              </div>
              <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">
                Our purpose
              </p>
              <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
                Find Your North Star
              </h2>
              <div className="space-y-5 text-lg text-muted-foreground leading-relaxed">
                <p>
                  Synozur is an advisory firm that transforms business for our clients. The name
                  'Synozur' is inspired by the ancient Greek term for the North Star, symbolizing
                  our unwavering commitment to guide you to success.
                </p>
                <p>
                  Our team of leaders from across the Fortune 500 delivers high-impact outcomes
                  for our clients. We believe in empathetic approaches, ensuring that your unique
                  journey is supported with the right strategies and solutions.
                </p>
                <p>
                  From efficiency and ROI to market success and adoption, we'll help you find
                  the tangible results you're seeking.
                </p>
              </div>
              <div className="mt-8">
                <Link
                  href="/about"
                  className="inline-flex items-center gap-2 text-primary font-semibold hover:text-primary/80 transition-colors"
                >
                  About Synozur <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-5">
              {closingEyebrow}
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-7 leading-tight">
              {closingHeadline}
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-10">
              {closingBody}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/start"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Start a Conversation
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="/case-studies"
                className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-transparent px-8 text-base font-medium transition-colors hover:bg-muted"
              >
                See Our Work
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <HomeShortcuts />

      <HomeConfigWedge />
    </div>
  );
}
