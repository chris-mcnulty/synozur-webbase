import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Monitor, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { HomeConfigWedge } from "@/components/home-config-wedge";

const BASE_PATH_HOME = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO_BG = "/images/hero-bg.png";
const DEFAULT_EDITORIAL = "/images/home-hero-editorial.png";
const BUNDLED_HERO_VIDEO_WEBM = `${BASE_PATH_HOME}/videos/hero-bg.webm`;
const BUNDLED_HERO_VIDEO_MP4 = `${BASE_PATH_HOME}/videos/hero-bg.mp4`;

function resolveImageUrl(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  // Backend returns paths like "/api/storage/objects/uploads/<id>"; prepend base path.
  if (url.startsWith("/api/")) return `${BASE_PATH_HOME}${url}`;
  return url;
}

import { Card, CardContent } from "@/components/ui/card";
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { fetchFeatured, type Collateral } from "@/data/collateral";
import { CollateralCard, CollateralCardSkeleton } from "@/components/collateral-card";
import { clientLogos, type LogoEntry } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";
import { BookingLinks } from "@/components/home/BookingLinks";
import { SocialProof } from "@/components/social-proof";
import { useOverride, useTrackConversion } from "@/lib/experiments";
import type { PartnerItem } from "@workspace/api-zod/types";
import { workshopsApi, type WorkshopDto } from "@/lib/api-workshops";
import { Skeleton } from "@/components/ui/skeleton";

export function FromTheFeedCarousel() {
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [current, setCurrent] = useState(0);
  const [items, setItems] = useState<Collateral[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const trackConversion = useTrackConversion();

  useEffect(() => {
    let cancelled = false;
    fetchFeatured()
      .then((res) => {
        if (!cancelled) setItems(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on("select", onSelect);
    // Honor prefers-reduced-motion: skip the auto-advance timer so the
    // carousel only moves when the user explicitly requests it.
    if (reducedMotion) {
      return () => {
        api.off("select", onSelect);
      };
    }
    const id = window.setInterval(() => api.scrollNext(), 6000);
    return () => {
      api.off("select", onSelect);
      window.clearInterval(id);
    };
  }, [api, reducedMotion]);

  if (error) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">
        Couldn't load the feed right now.
      </div>
    );
  }

  if (!items) {
    return (
      <div>
        <div className="flex items-end justify-between mb-6 gap-4">
          <p className="text-sm uppercase tracking-[0.25em] text-primary">From The Feed</p>
        </div>
        <CollateralCardSkeleton variant="carousel" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <div className="flex items-end justify-between mb-6 gap-4">
          <p className="text-sm uppercase tracking-[0.25em] text-primary">From The Feed</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">
          New stories coming soon.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4">
        <p className="text-sm uppercase tracking-[0.25em] text-primary">From The Feed</p>
        <div className="hidden md:flex gap-2">
          <CarouselPreviousProxy api={api} />
          <CarouselNextProxy api={api} />
        </div>
      </div>
      <Carousel
        setApi={setApi}
        opts={{ loop: true, align: "start" }}
        className="w-full"
      >
        <CarouselContent>
          {items.map((item) => (
            <CarouselItem key={item.id} className="basis-full">
              <CollateralCard
                item={item}
                variant="carousel"
                imageLoading="eager"
                onClick={() =>
                  trackConversion("conversion.carousel.click", {
                    itemId: item.id,
                    itemType: item.type,
                    itemTitle: item.title,
                    itemUrl: item.url,
                  })
                }
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="md:hidden -left-2" />
        <CarouselNext className="md:hidden -right-2" />
      </Carousel>
      <div className="flex items-center justify-center gap-2 mt-6">
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            aria-label={`Show slide ${i + 1}: ${it.title}`}
            onClick={() => api?.scrollTo(i)}
            className={`h-1.5 rounded-full transition-all ${
              current === i ? "w-8 bg-primary" : "w-3 bg-white/25 hover:bg-white/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function CarouselPreviousProxy({ api }: { api: CarouselApi | null }) {
  return (
    <button
      type="button"
      onClick={() => api?.scrollPrev()}
      aria-label="Previous slide"
      className="h-9 w-9 rounded-full border border-border bg-card/60 backdrop-blur-md flex items-center justify-center text-foreground hover:bg-muted transition-colors"
    >
      <ArrowRight className="h-4 w-4 rotate-180" />
    </button>
  );
}
function CarouselNextProxy({ api }: { api: CarouselApi | null }) {
  return (
    <button
      type="button"
      onClick={() => api?.scrollNext()}
      aria-label="Next slide"
      className="h-9 w-9 rounded-full border border-border bg-card/60 backdrop-blur-md flex items-center justify-center text-foreground hover:bg-muted transition-colors"
    >
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}

export function HomeShortcuts() {
  const { isSignedIn, isLoaded, signIn } = useAuth();

  if (!isLoaded || isSignedIn) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <button
        type="button"
        onClick={() => signIn("/admin")}
        className="flex items-center gap-1.5 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 text-white/40 text-xs px-3 py-1.5 hover:text-white/70 hover:bg-white/10 transition-colors"
        title="Sign in"
      >
        <Lock className="h-3 w-3" />
        Sign in
      </button>
    </div>
  );
}

// Render the hero headline, wrapping the accent word in `nebula-text`
// styling. If the override-supplied accentWord doesn't appear in the
// text, the whole headline renders without an accent.
function HeroHeadline({ text, accentWord }: { text: string; accentWord: string }) {
  if (!accentWord || !text.includes(accentWord)) {
    return <>{text}</>;
  }
  const idx = text.indexOf(accentWord);
  return (
    <>
      {text.slice(0, idx)}
      <span className="nebula-text">{accentWord}</span>
      {text.slice(idx + accentWord.length)}
    </>
  );
}

// Adapter: PartnerItem (override shape) → LogoEntry (renderer shape).
// The override schema doesn't carry a `variant` since the rotator
// styling is deck-wide; we pin it to "light" to match the existing
// homepage section.
function partnersToLogos(items: PartnerItem[]): LogoEntry[] {
  return items.map((p) => ({
    name: p.alt || "",
    src: p.src,
    variant: "light" as const,
    href: p.href ?? undefined,
  }));
}

export default function Home() {
  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
  });
  const trackConversion = useTrackConversion();

  // ----- Experiment overrides -------------------------------------------
  // Each call falls back to the existing default copy when no running
  // experiment touches the key, so removing an experiment cleanly reverts
  // the page to today's content with no code change.
  const positioningVisible = useOverride<boolean>(
    "home.hero.positioning.visible",
    true,
  );
  const positioningText = useOverride<string>(
    "home.hero.positioning.text",
    "The Transformation Company",
  );
  const positioningAccent = useOverride<string>(
    "home.hero.positioning.accentWord",
    "Transformation",
  );
  const taglineText = useOverride<string>(
    "home.hero.tagline.text",
    "Transformation with momentum — AI‑native, human‑centered. We guide leaders through the North Star Method™ (Assess · Define · Deliver · Outcomes) so strategy lands as measurable progress, not slideware.",
  );
  const heroCtaVisible = useOverride<boolean>("home.hero.cta.visible", true);
  const heroCtaLabel = useOverride<string>("home.hero.cta.label", "Get Started");
  const heroCtaHref = useOverride<string>("home.hero.cta.href", "/start");
  // Method section aside — overridable so a variant can swap the
  // "Where it lands first" industry list for alternate copy (e.g.
  // "Find Your North Star"). Set home.method.aside.body to a non-empty
  // string (paragraphs separated by \n\n) to replace the default list.
  const methodAsideHeadline = useOverride<string>("home.method.aside.headline", "");
  const methodAsideBody = useOverride<string>("home.method.aside.body", "");
  const methodAsideCtaLabel = useOverride<string>("home.method.aside.cta", "");
  const methodAsideCtaHref = useOverride<string>("home.method.aside.ctaHref", "");
  const partnersVisible = useOverride<boolean>("home.partners.visible", true);
  const partnersHeading = useOverride<string>("home.partners.heading", "Trusted by");
  const partnersSubtext = useOverride<string>("home.partners.subtext", "");
  const partnersItems = useOverride<PartnerItem[] | null>(
    "home.partners.items",
    null,
  );
  // Client social-proof band (experiment engine: home.socialProof.*). Empty
  // string framing-copy overrides fall back to the component's own defaults.
  const socialProofVisible = useOverride<boolean>("home.socialProof.visible", true);
  const socialProofEyebrow = useOverride<string>("home.socialProof.eyebrow", "");
  const socialProofHeading = useOverride<string>("home.socialProof.heading", "");
  const {
    data: workshopsData,
    isLoading: workshopsLoading,
    isError: workshopsError,
  } = useQuery({
    queryKey: ["public-workshops"],
    queryFn: () => workshopsApi.listPublic(),
  });
  const workshops: WorkshopDto[] = (workshopsData?.items ?? []).slice(0, 4);
  const hasWorkshopsTeaserFallback = workshopsLoading || workshopsError;
  const heroBg = resolveImageUrl(settings?.homeHeroImageUrl, DEFAULT_HERO_BG);
  const editorial = resolveImageUrl(settings?.homeEditorialImageUrl, DEFAULT_EDITORIAL);
  const customVideoSrc = settings?.homeHeroVideoUrl
    ? resolveImageUrl(settings.homeHeroVideoUrl, BUNDLED_HERO_VIDEO_MP4)
    : null;

  const [videoReady, setVideoReady] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reducedMotion = useReducedMotion();
  const useHeroVideo =
    settings?.homeHeroBackgroundType === "video" && !reducedMotion;

  useEffect(() => {
    if (!videoReady || !videoRef.current) return;
    videoRef.current.load();
    // P1 #6 — Slow the cosmic/starfield background to ~0.5x. The
    // bundled clip plays back too fast at native speed and reads as
    // dizzying motion rather than ambient. We also re-apply the rate
    // on `play` because some browsers reset playbackRate during a
    // `load()` cycle or after the video stalls and recovers.
    const v = videoRef.current;
    const SLOW = 0.5;
    v.playbackRate = SLOW;
    const onPlay = () => {
      v.playbackRate = SLOW;
    };
    v.addEventListener("play", onPlay);
    return () => {
      v.removeEventListener("play", onPlay);
    };
  }, [videoReady]);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    // Use a plain setTimeout(0) so the video sources are appended reliably in
    // both dev (HMR keeps the browser busy, so requestIdleCallback never fires)
    // and production.
    const schedule = (cb: () => void) => setTimeout(cb, 0);
    if (!("IntersectionObserver" in window)) {
      schedule(() => setVideoReady(true));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          schedule(() => setVideoReady(true));
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full">
      <Meta
        title="Transform Your Business with The Synozur Alliance | Strategic Advisory Services"
        rawTitle
        description="We help organizations move from intent to measurable progress—guiding leaders to their North Star with human‑centered, AI‑augmented transformation that's built for real‑world adoption."
        path="/"
        image="/images/hero-bg.png"
      />

      {/* Hero Section */}
      <section ref={heroRef} className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#0B0B1A]">
        {/* P1 #6 — bumped from opacity-60 → opacity-80 so the cosmic
            background reads as crisp ambient motion instead of soft
            focus. The dark gradient overlay below still keeps copy
            readable. */}
        <div className="absolute inset-0 z-0 opacity-80">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0B0B1A] z-10" />
          {useHeroVideo ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              loop
              playsInline
              poster={heroBg}
              className="w-full h-full object-cover"
              data-testid="video-home-hero-bg"
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
              <img
                src={heroBg}
                alt="Cosmic nebula background"
                className="w-full h-full object-cover"
                fetchPriority="high"
              />
            </video>
          ) : (
            <img
              src={heroBg}
              alt="Cosmic nebula background"
              className="w-full h-full object-cover"
              fetchPriority="high"
              data-testid="img-home-hero-bg"
            />
          )}
        </div>

        <div className="container relative z-10 mx-auto px-4 py-20 md:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="lg:col-span-6"
            >
              <img
                src={`${BASE_PATH_HOME}/images/sa-logo-horizontal-white.png`}
                alt="The Synozur Alliance"
                width={460}
                height={125}
                className="h-28 md:h-32 w-auto max-w-full mb-10"
                style={{ mixBlendMode: "screen" }}
                fetchPriority="high"
              />
              {positioningVisible ? (
                <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-8">
                  <HeroHeadline text={positioningText} accentWord={positioningAccent} />
                </h1>
              ) : null}
              <p className="text-xl md:text-2xl text-zinc-300 mb-10 max-w-2xl leading-relaxed">
                {taglineText}
              </p>
              {heroCtaVisible ? (
                <Link
                  href={heroCtaHref}
                  className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                  onClick={() =>
                    trackConversion("conversion.cta.get_started", {
                      location: "hero",
                      href: heroCtaHref,
                      label: heroCtaLabel,
                    })
                  }
                >
                  {heroCtaLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              ) : null}
            </motion.div>

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

      {/* Our Method — North Star Method™ */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl mb-12"
          >
            <p className="text-sm uppercase tracking-widest text-primary mb-3">
              Our Method
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              The North Star Method™
            </h2>
            <p className="text-lg text-muted-foreground">
              Four phases that turn a board-room ambition into compounding,
              real-world progress. We meet you at the phase you need and stay
              until the change sticks — AI-augmented, human-centered, and
              guarded by critical thinking at every step.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                phase: "Assess",
                body: "Where are we starting? Surface the gaps, the risks, and the market signals that make the case before any strategy is set.",
                href: "/solutions/ai-strategy-and-design",
                cta: "AI Strategy & Design",
              },
              {
                phase: "Define",
                body: "What's the strategy and readiness? Get leaders, teams, and AI on one plan — clear ownership, clear guardrails, no hidden agendas.",
                href: "/solutions/ai-strategy-and-design",
                cta: "AI Strategy & Design",
              },
              {
                phase: "Deliver",
                body: "What are we building together? GTM motions, pilots, and operating changes that prove the case with revenue, not slideware.",
                href: "/solutions/gtm-strategy-and-execution",
                cta: "GTM Strategy & Execution",
              },
              {
                phase: "Outcomes",
                body: "Did the transformation stick? Embed the habits, measurement, and operating rhythm so progress compounds across the org.",
                href: "/solutions/company-os",
                cta: "Company OS",
              },
            ].map((p, i) => (
              <motion.div
                key={p.phase}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.06 }}
                className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col"
              >
                <div className="text-xs uppercase tracking-widest text-primary mb-2">
                  Phase {i + 1}
                </div>
                <h3 className="text-xl font-bold mb-3">{p.phase}</h3>
                <p className="text-sm text-muted-foreground mb-6 flex-1">
                  {p.body}
                </p>
                <Link
                  href={p.href}
                  className="inline-flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  {p.cta} <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </motion.div>
            ))}
          </div>

          <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                {methodAsideHeadline || "Where it lands first"}
              </h3>
              {methodAsideBody ? (
                <div className="space-y-4 text-base text-muted-foreground">
                  {methodAsideBody.replace(/\\n/g, "\n").split("\n\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              ) : (
                <ul className="space-y-3 text-base text-muted-foreground">
                  <li><span className="font-semibold text-foreground">Insurance:</span> AI underwriting copilots that protect loss ratios without scaring the regulator.</li>
                  <li><span className="font-semibold text-foreground">Tech &amp; Software:</span> GTM repositioning when the old category story stops closing deals.</li>
                  <li><span className="font-semibold text-foreground">Energy:</span> Operating-model redesign for a workforce that's half on the truck, half on the laptop.</li>
                  <li><span className="font-semibold text-foreground">Life Sciences:</span> Commercial readiness and field-team enablement that survives the launch window.</li>
                </ul>
              )}
              <div className="mt-6">
                <Link href={methodAsideCtaHref || "/about"} className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors">
                  {methodAsideCtaLabel || "Why Synozur"} <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-square rounded-2xl overflow-hidden border border-border/50 shadow-2xl bg-card"
            >
              <img
                src={editorial}
                alt="Editorial: leadership team in a modern conference room"
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                data-testid="img-home-editorial"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent z-10 opacity-30 mix-blend-overlay" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Trusted by — client/partner logo rotator. The default logo set
          comes from data/logos.ts; experiments may swap in a different
          set via the home.partners.items override. */}
      {partnersVisible ? (
        <section className="py-16 bg-[hsl(240_35%_10%)] border-y border-border">
          <div className="container mx-auto px-4">
            <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-6">
              {partnersHeading}
            </p>
            {partnersSubtext ? (
              <p className="text-sm text-zinc-400 text-center max-w-2xl mx-auto mb-6">
                {partnersSubtext}
              </p>
            ) : null}
            <LogoRotator
              logos={partnersItems ? partnersToLogos(partnersItems) : clientLogos}
            />
          </div>
        </section>
      ) : null}

      {/* Booking links block — hidden by default; populated only when an
          experiment sets home.booking.* overrides. */}
      <BookingLinks />

      {/* Three-up: Services / Projects / Clients */}
      <section className="py-24 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-border/50 bg-background/50 hover-elevate">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold mb-4">Our Services</h3>
                <p className="text-muted-foreground mb-6">
                  Synozur fosters human-centered business transformation - from strategic and operational transformation to technology, design, and market strategies.
                </p>
                <Link href="/services-overview/default" className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors">
                  Explore Our Services <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-background/50 hover-elevate">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold mb-4">Our Projects</h3>
                <p className="text-muted-foreground mb-6">
                  Explore our successful projects that have driven high-impact transformation for our clients. Each project is a testament of our unwavering commitment to guiding you to success.
                </p>
                <Link href="/case-studies" className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors">
                  View Our Projects <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-background/50 hover-elevate">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold mb-4">Our Clients</h3>
                <p className="text-muted-foreground mb-6">
                  We are privileged to work with a diverse range of clients across various industries. Our collaborative approach and tailored strategies have led to successful partnerships and transformative outcomes.
                </p>
                <Link href="/clients" className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors">
                  See Our Clients <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Client social proof — real pull-quotes + outcomes from published
          case studies. Renders nothing when no case study has a quote.
          Visibility + framing copy are experiment-overridable
          (home.socialProof.*). */}
      {socialProofVisible ? (
        <SocialProof
          {...(socialProofEyebrow ? { eyebrow: socialProofEyebrow } : {})}
          {...(socialProofHeading ? { heading: socialProofHeading } : {})}
        />
      ) : null}

      {/* Workshops Teaser */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12"
          >
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">Workshops</p>
              <h2 className="text-3xl md:text-4xl font-bold">
                Transform your team in a day
              </h2>
              <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
                Focused, facilitated intensives that turn leadership conversations into prioritized plans — with deliverables you can act on immediately.
              </p>
            </div>
            <Link
              href="/workshops"
              className="inline-flex shrink-0 items-center text-primary font-semibold hover:text-primary/80 transition-colors"
            >
              View all workshops <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {hasWorkshopsTeaserFallback ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col rounded-2xl border border-border/60 bg-card overflow-hidden">
                  <Skeleton className="aspect-[16/9] w-full rounded-none" />
                  <div className="flex flex-col flex-1 p-6 gap-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <div className="mt-2 flex gap-3">
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-3 w-14" />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              workshops.map((workshop, i) => (
              <motion.div
                key={workshop.slug}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <Link href={`/workshops/${workshop.slug}`} className="group block h-full">
                  <div className="flex flex-col h-full rounded-2xl border border-border/60 bg-card overflow-hidden hover-elevate">
                    <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                      <img
                        src={workshop.heroImage}
                        alt={workshop.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <span className="absolute bottom-3 left-3 inline-block py-0.5 px-2.5 rounded-full bg-white/10 border border-white/25 text-white text-[10px] tracking-[0.15em] font-semibold backdrop-blur-md">
                        {workshop.category}
                      </span>
                    </div>
                    <div className="flex flex-col flex-1 p-6">
                      <h3 className="font-bold text-base leading-snug mb-2 group-hover:text-primary transition-colors">
                        {workshop.title}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                        {workshop.shortDescription}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {workshop.duration}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Monitor className="h-3 w-3" /> {workshop.deliveryFormat}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))
            )}
          </div>
        </div>
      </section>

      <HomeShortcuts />

      <HomeConfigWedge />
    </div>
  );
}
