import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Building2, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { clientLogos } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";
import { workshopsApi, type WorkshopDto } from "@/lib/api-workshops";
import { Skeleton } from "@/components/ui/skeleton";
import { FromTheFeedCarousel } from "@/pages/home";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO_BG = "/images/hero-bg.png";
const BUNDLED_HERO_VIDEO_WEBM = `${BASE_PATH}/videos/hero-bg.webm`;
const BUNDLED_HERO_VIDEO_MP4 = `${BASE_PATH}/videos/hero-bg.mp4`;

function resolveImageUrl(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  if (url.startsWith("/api/")) return `${BASE_PATH}${url}`;
  return url;
}

const PILLARS = [
  {
    headline: "Clarity before motion.",
    body: "Competing priorities stall organizations, not missing ideas. Every Synozur engagement starts with a diagnostic — so decisions are grounded in what's actually true.",
    proofLabel: "See our assessment approach",
    proofHref: "/applications/orion",
  },
  {
    headline: "Assessment is the first act of leadership.",
    body: "We listen before we advise. The Orion diagnostic gives leadership teams a shared, honest account of where things stand before committing to direction.",
    proofLabel: "Explore Orion",
    proofHref: "/applications/orion",
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

const SOFTWARE = [
  {
    slug: "orion",
    name: "Orion",
    tagline: "Where every engagement begins.",
    lens: "inside" as const,
    lensLabel: "Internal Assessment",
    description:
      "Orion is Synozur's organizational diagnostic platform. It surfaces the signals that matter inside your organization — helping leadership teams align around a shared picture of current-state reality before committing to strategy.",
  },
  {
    slug: "vega",
    name: "Vega",
    tagline: "Strategy made trackable.",
    lens: "inside" as const,
    lensLabel: "Internal Execution",
    description:
      "Vega connects strategic decisions to measurable outcomes inside the organization. Leaders get a live view of how initiatives are advancing, where momentum is building, and where attention is needed — so strategy doesn't stay in the deck.",
  },
  {
    slug: "orbit",
    name: "Orbit",
    tagline: "The market, made legible.",
    lens: "outside" as const,
    lensLabel: "External Intelligence",
    description:
      "Orbit surfaces outside-in intelligence — market signals, competitor moves, positioning dynamics, and go-to-market context. It gives Synozur clients a clear view of the landscape their strategy must navigate, not just the terrain inside their organization.",
  },
];

export default function HomeB() {
  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
  });

  const { data: workshopsData, isLoading: workshopsLoading } = useQuery({
    queryKey: ["public-workshops"],
    queryFn: () => workshopsApi.listPublic(),
  });
  const allWorkshops: WorkshopDto[] = workshopsData?.items ?? [];
  const featuredWorkshop = allWorkshops[0] ?? null;
  const secondaryWorkshops = allWorkshops.slice(1, 3);

  const heroBg = resolveImageUrl(settings?.homeHeroImageUrl, DEFAULT_HERO_BG);
  const customVideoSrc = settings?.homeHeroVideoUrl
    ? resolveImageUrl(settings.homeHeroVideoUrl, BUNDLED_HERO_VIDEO_MP4)
    : null;

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
        image="/images/hero-bg.png"
      />

      {/* ── Hero: two-column ── */}
      <section ref={heroRef} className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#0B0B1A]">
        <div className="absolute inset-0 z-0 opacity-60">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0B0B1A] z-10" />
          {settings?.homeHeroBackgroundType === "video" ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              loop
              playsInline
              poster={heroBg}
              className="w-full h-full object-cover"
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
              <img src={heroBg} alt="" className="w-full h-full object-cover" />
            </video>
          ) : (
            <img src={heroBg} alt="" className="w-full h-full object-cover" />
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
              />
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-8 leading-[1.06]">
                The <span className="nebula-text">Transformation</span> Company
              </h1>
              <p className="text-xl md:text-2xl text-zinc-300 mb-10 max-w-xl leading-relaxed">
                Built tools, models, and methods for executives navigating complex change — from first assessment to measurable outcome.
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
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">How we work</p>
            <h2 className="text-3xl md:text-4xl font-bold leading-tight">
              A disciplined approach. Not a methodology deck.
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-12">
            {PILLARS.map((pillar, i) => (
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
                Synozur's three platforms make strategy operational — from the first diagnostic
                to ongoing execution to market positioning. Each addresses a distinct view of
                your organization's challenge.
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
              {SOFTWARE.map((app, i) => (
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
              In practice
            </p>
            <h2 className="text-2xl md:text-3xl font-bold max-w-2xl mb-3">
              Models, applications, cases, and conversations — how the system works in the real world.
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Synozur's IP isn't advisory opinion. It's documented thinking — built into tools, tested with clients, and refined through real engagements.
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
              Commit to direction. Leave with a plan.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Synozur workshops are designed for leadership teams that need to move from open questions to locked decisions. Not seminars. Not training. Facilitated intensives built around your specific challenge — that end with clarity, commitment, and a next step you can act on.
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
              Ready to begin
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-7 leading-tight">
              Every engagement starts with a real conversation.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-10">
              If you're navigating a market shift, an AI transformation, or a leadership
              reorganization — we'd like to understand it with you. Not pitch to you.
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
    </div>
  );
}
