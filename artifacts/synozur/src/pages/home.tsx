import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Monitor, Lock, Settings2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth";
import { useAdminAccess } from "@/components/admin/AdminGate";

const BASE_PATH_HOME = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const DEFAULT_HERO_BG = "/images/hero-bg.png";
const DEFAULT_EDITORIAL = "/images/home-hero-editorial.png";

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
import { clientLogos } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";
import { workshops } from "@/data/workshops";

function FromTheFeedCarousel() {
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [current, setCurrent] = useState(0);
  const [items, setItems] = useState<Collateral[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const id = window.setInterval(() => api.scrollNext(), 6000);
    return () => {
      api.off("select", onSelect);
      window.clearInterval(id);
    };
  }, [api]);

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

function HomeShortcuts() {
  const { isSignedIn, isLoaded, signIn } = useAuth();
  const { access, isLoading: accessLoading } = useAdminAccess();
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  if (!isLoaded || accessLoading) return null;

  const isAdmin = access?.isAllowListed || access?.hasCmsRole;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {isSignedIn && isAdmin && (
        <a
          href={`${basePath}/admin`}
          className="flex items-center gap-1.5 rounded-full bg-[#810FFB]/90 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 shadow-lg hover:bg-[#810FFB] transition-colors"
          title="Open admin panel"
        >
          <Settings2 className="h-3 w-3" />
          Admin
        </a>
      )}
      {!isSignedIn && (
        <button
          type="button"
          onClick={() => signIn("/admin")}
          className="flex items-center gap-1.5 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 text-white/40 text-xs px-3 py-1.5 hover:text-white/70 hover:bg-white/10 transition-colors"
          title="Sign in with Microsoft"
        >
          <Lock className="h-3 w-3" />
          Sign in
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const { data: settings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => api.getPublicSiteSettings(),
  });
  const heroBg = resolveImageUrl(settings?.homeHeroImageUrl, DEFAULT_HERO_BG);
  const editorial = resolveImageUrl(settings?.homeEditorialImageUrl, DEFAULT_EDITORIAL);
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
      <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#0B0B1A]">
        <div className="absolute inset-0 z-0 opacity-60">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0B0B1A] z-10" />
          {settings?.homeHeroBackgroundType === "video" ? (
            <video
              autoPlay
              muted
              loop
              playsInline
              poster={heroBg}
              className="w-full h-full object-cover"
              data-testid="video-home-hero-bg"
            >
              <source src={`${BASE_PATH_HOME}/videos/hero-bg.webm`} type="video/webm" />
              <source src={`${BASE_PATH_HOME}/videos/hero-bg.mp4`} type="video/mp4" />
              <img
                src={heroBg}
                alt="Cosmic nebula background"
                className="w-full h-full object-cover"
              />
            </video>
          ) : (
            <img
              src={heroBg}
              alt="Cosmic nebula background"
              className="w-full h-full object-cover"
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
              <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/20 text-white text-sm font-medium mb-6 backdrop-blur-sm">
                The Synozur Alliance
              </span>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white mb-8">
                The <span className="nebula-text">Transformation</span> Company
              </h1>
              <p className="text-xl md:text-2xl text-zinc-300 mb-10 max-w-2xl leading-relaxed">
                {/* Fallback: We guide organizations to their North Star by charting the course through transformation rooted in people, powered by technology, and driven by purpose. */}
                We help organizations move from intent to measurable progress—guiding leaders to their North Star with human&#x2011;centered, AI&#x2011;augmented transformation that&rsquo;s built for real&#x2011;world adoption.
              </p>
              <Link
                href="/start"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
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

      {/* Find Your North Star */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-6">Find Your North Star</h2>
              <div className="space-y-4 text-lg text-muted-foreground">
                <p>
                  Synozur is an advisory firm that transforms business for our clients. The name 'Synozur' is inspired by the ancient Greek term for the North Star, symbolizing our unwavering commitment to guide you to success.
                </p>
                <p>
                  Our team of leaders from across the Fortune 500 delivers high-impact outcomes for our clients. We believe in empathetic approaches, ensuring that your unique journey is supported with the right strategies and solutions. From efficiency and ROI to market success and adoption, we'll help you find the tangible results you're seeking.
                </p>
              </div>
              <div className="mt-8">
                <Link href="/about" className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors">
                  Our Story <ArrowRight className="ml-2 h-4 w-4" />
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
                data-testid="img-home-editorial"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent z-10 opacity-30 mix-blend-overlay" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Trusted by — client/partner logo rotator */}
      <section className="py-16 bg-[hsl(240_35%_10%)] border-y border-border">
        <div className="container mx-auto px-4">
          <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-6">
            Trusted by
          </p>
          <LogoRotator logos={clientLogos} />
        </div>
      </section>

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
            ))}
          </div>
        </div>
      </section>

      <HomeShortcuts />
    </div>
  );
}
