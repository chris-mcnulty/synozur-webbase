import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
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
import { clientLogos } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";
import { workshopsApi, type WorkshopDto } from "@/lib/api-workshops";
import { Skeleton } from "@/components/ui/skeleton";

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
    body: "Organizations rarely struggle for lack of ideas. They stall when competing priorities obscure which direction actually matters. Every engagement begins here — with a clear-eyed account of where things stand.",
  },
  {
    headline: "Honest assessment is the first act of leadership.",
    body: "We listen before we advise. Understanding your situation fully — what's working, what isn't, and why — is the only foundation worth building on.",
  },
  {
    headline: "Strategy becomes real in execution.",
    body: "A plan that lives in a deck is not a plan. We work alongside your teams to build the momentum that carries decisions from the conference room into practice.",
  },
  {
    headline: "Outcomes are the only measure.",
    body: "We define success in concrete terms from the start, and we stay until those terms are met. Transformation isn't complete until it's visible in the work.",
  },
];

const SOFTWARE = [
  {
    slug: "orion",
    name: "Orion",
    tagline: "Where most leaders begin.",
    description:
      "Orion makes the current state of your organization legible — surfacing the signals that matter and helping leadership teams align around a shared picture of reality before committing to direction.",
  },
  {
    slug: "vega",
    name: "Vega",
    tagline: "Turning strategy into tracked progress.",
    description:
      "Vega connects decisions to measurable outcomes. It gives leaders a living view of how strategic initiatives are advancing, where momentum is building, and where attention is needed.",
  },
  {
    slug: "orbit",
    name: "Orbit",
    tagline: "Relationships that sustain transformation.",
    description:
      "Orbit keeps the human dimension of change visible. It helps organizations understand how trust, influence, and alignment are evolving across teams and stakeholder networks.",
  },
];

function FeedCarousel() {
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);
  const [current, setCurrent] = useState(0);
  const [items, setItems] = useState<Collateral[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFeatured()
      .then((res) => { if (!cancelled) setItems(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!carouselApi) return;
    setCurrent(carouselApi.selectedScrollSnap());
    const onSelect = () => setCurrent(carouselApi.selectedScrollSnap());
    carouselApi.on("select", onSelect);
    const id = window.setInterval(() => carouselApi.scrollNext(), 6000);
    return () => {
      carouselApi.off("select", onSelect);
      window.clearInterval(id);
    };
  }, [carouselApi]);

  if (error) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">
        Couldn't load the feed right now.
      </div>
    );
  }

  if (!items) {
    return <CollateralCardSkeleton variant="carousel" />;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 text-sm text-muted-foreground">
        New stories coming soon.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4">
        <div className="hidden md:flex gap-2">
          <button
            type="button"
            onClick={() => carouselApi?.scrollPrev()}
            aria-label="Previous slide"
            className="h-9 w-9 rounded-full border border-border bg-card/60 backdrop-blur-md flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => carouselApi?.scrollNext()}
            aria-label="Next slide"
            className="h-9 w-9 rounded-full border border-border bg-card/60 backdrop-blur-md flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <Carousel setApi={setCarouselApi} opts={{ loop: true, align: "start" }} className="w-full">
        <CarouselContent>
          {items.map((item) => (
            <CarouselItem key={item.id} className="basis-full">
              <CollateralCard item={item} variant="carousel" />
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
            onClick={() => carouselApi?.scrollTo(i)}
            className={`h-1.5 rounded-full transition-all ${
              current === i ? "w-8 bg-primary" : "w-3 bg-white/25 hover:bg-white/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default function HomeB() {
  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
  });

  const { data: workshopsData, isLoading: workshopsLoading, isError: workshopsError } = useQuery({
    queryKey: ["public-workshops"],
    queryFn: () => workshopsApi.listPublic(),
  });
  const workshops: WorkshopDto[] = (workshopsData?.items ?? []).slice(0, 3);
  const workshopsLoaded = !workshopsLoading && !workshopsError;

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
        title="The Synozur Alliance — Strategic Transformation for Complex Organizations"
        rawTitle
        description="Synozur guides executives through complex change with strategic clarity, human-centered methods, and measurable outcomes. This is transformation built for the real world."
        path="/home-b"
        image="/images/hero-bg.png"
      />

      {/* ── Hero ── */}
      <section ref={heroRef} className="relative min-h-[92vh] flex items-center overflow-hidden bg-[#0B0B1A]">
        <div className="absolute inset-0 z-0 opacity-60">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0B0B1A]/30 to-[#0B0B1A] z-10" />
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

        <div className="container relative z-10 mx-auto px-4 py-24 md:py-32">
          <div className="max-w-3xl">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            >
              <img
                src={`${BASE_PATH}/images/sa-logo-horizontal-white.png`}
                alt="The Synozur Alliance"
                className="h-24 md:h-28 w-auto mb-12"
                style={{ mixBlendMode: "screen" }}
              />
              <p className="text-sm uppercase tracking-[0.25em] text-primary mb-5">
                The Transformation Company
              </p>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-8 leading-[1.08]">
                A system for navigating{" "}
                <span className="nebula-text">complexity</span> with confidence.
              </h1>
              <p className="text-xl md:text-2xl text-zinc-300 mb-12 max-w-2xl leading-relaxed">
                Synozur works with executives who are leading consequential change — in organizations
                where the stakes are high, the environment is shifting, and clarity is the rarest resource.
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
                  href="/about"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-white/20 bg-white/5 px-8 text-base font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/10"
                >
                  Our Story
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Trusted by ── */}
      <section className="py-12 bg-[hsl(240_35%_10%)] border-y border-border">
        <div className="container mx-auto px-4">
          <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-6">
            Trusted by
          </p>
          <LogoRotator logos={clientLogos} />
        </div>
      </section>

      {/* ── Pillars passage ── */}
      <section className="py-28 bg-background">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-xl mb-20"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">How we work</p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Synozur operates with a disciplined approach to change. You won't see it enumerated —
              but you will feel it in every engagement.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
            {PILLARS.map((pillar, i) => (
              <motion.div
                key={pillar.headline}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <div className="w-8 h-px bg-primary mb-6" />
                <h3 className="text-2xl md:text-3xl font-bold mb-4 leading-snug">
                  {pillar.headline}
                </h3>
                <p className="text-muted-foreground leading-relaxed">{pillar.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Software narrative ── */}
      <section className="py-28 bg-[hsl(240_35%_8%)] border-y border-border">
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
                Thinking made visible
              </p>
              <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
                Tools that operationalize your strategy — not replace it.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                Synozur has built software to make strategic thinking visible, trackable, and shared.
                These are not products to procure. They are the instruments through which Synozur
                operationalizes its advisory work.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Most leaders begin with Orion — because understanding the current state clearly is
                the prerequisite for everything that follows.
              </p>
            </motion.div>

            <div className="flex flex-col gap-6">
              {SOFTWARE.map((app, i) => (
                <motion.div
                  key={app.slug}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.12 }}
                  className="group relative rounded-2xl border border-border/60 bg-card p-8 hover-elevate transition-all"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-primary mb-1">
                        {app.tagline}
                      </p>
                      <h3 className="text-2xl font-bold">{app.name}</h3>
                    </div>
                    <Link
                      href={`/applications/${app.slug}`}
                      className="flex-shrink-0 h-9 w-9 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:border-primary transition-colors"
                      aria-label={`Learn about ${app.name}`}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{app.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Workshops ── */}
      <section className="py-28 bg-background">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl mb-16"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">Workshops</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
              A day that can change the shape of a year.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Synozur workshops are designed for moments when a leadership team needs to move from
              conversation to commitment. Facilitated intensives that produce decisions, alignment,
              and clarity — not decks.
            </p>
          </motion.div>

          {workshopsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col rounded-2xl border border-border/60 bg-card overflow-hidden">
                  <Skeleton className="aspect-[16/9] w-full rounded-none" />
                  <div className="flex flex-col flex-1 p-6 gap-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                  </div>
                </div>
              ))}
            </div>
          ) : workshopsLoaded && workshops.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {workshops.map((workshop, i) => (
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
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      </div>
                      <div className="flex flex-col flex-1 p-6">
                        <h3 className="font-bold text-base leading-snug mb-2 group-hover:text-primary transition-colors">
                          {workshop.title}
                        </h3>
                        <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                          {workshop.shortDescription}
                        </p>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : null}

          <div className="mt-10">
            <Link
              href="/workshops"
              className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors"
            >
              See all workshops <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Feed carousel ── */}
      <section className="py-28 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-10"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">
              How Synozur works in the real world
            </p>
            <h2 className="text-2xl md:text-3xl font-bold max-w-xl">
              Models, applications, cases, and conversations — in practice.
            </h2>
          </motion.div>
          <FeedCarousel />
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="py-28 bg-background">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl"
          >
            <p className="text-sm uppercase tracking-[0.25em] text-primary mb-5">
              Ready when you are
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-8 leading-tight">
              Every engagement begins with a conversation.
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-10">
              If you're navigating a consequential transition — a market shift, an AI adoption
              challenge, a leadership reorganization — we'd like to understand it with you.
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
