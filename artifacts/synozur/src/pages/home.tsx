import { useEffect, useState } from "react";
import { Meta } from "@/lib/meta";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { feedItems } from "@/data/feed";
import { rotatorLogos } from "@/data/logos";
import { LogoRotator } from "@/components/logo-rotator";

function FeedCard({ item }: { item: typeof feedItems[number] }) {
  const inner = (
    <div className="group relative block aspect-[4/5] md:aspect-[3/4] overflow-hidden rounded-2xl border border-border/60 bg-card">
      <img
        src={item.image}
        alt={item.title}
        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10 z-10" />
      <div className="absolute inset-x-0 bottom-0 z-20 p-6 md:p-8">
        <span className="inline-block py-1 px-3 rounded-full bg-white/10 border border-white/25 text-white text-[11px] tracking-[0.2em] font-semibold backdrop-blur-md mb-4">
          {item.category}
        </span>
        <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight">
          {item.title}
        </h3>
      </div>
    </div>
  );
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return (
    <Link href={item.href} className="block">
      {inner}
    </Link>
  );
}

function FromTheFeedCarousel() {
  const [api, setApi] = useState<CarouselApi | null>(null);
  const [current, setCurrent] = useState(0);

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
          {feedItems.map((item) => (
            <CarouselItem key={item.id} className="basis-full">
              <FeedCard item={item} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="md:hidden -left-2" />
        <CarouselNext className="md:hidden -right-2" />
      </Carousel>
      <div className="flex items-center justify-center gap-2 mt-6">
        {feedItems.map((it, i) => (
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

export default function Home() {
  return (
    <div className="w-full">
      <Meta
        title="Transform Your Business with The Synozur Alliance | Strategic Advisory Services"
        rawTitle
        description="The Synozur Alliance guides organizations to their North Star by charting the course through transformation rooted in people, powered by technology, and driven by purpose."
        path="/"
        image="/images/hero-bg.png"
      />

      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#0B0B1A]">
        <div className="absolute inset-0 z-0 opacity-60">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0B0B1A] z-10" />
          <img
            src="/images/hero-bg.png"
            alt="Cosmic nebula background"
            className="w-full h-full object-cover"
          />
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
                We guide organizations to their North Star by charting the course through transformation rooted in people, powered by technology, and driven by purpose.
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
                src="/images/home-hero-editorial.png"
                alt="Editorial: leadership team in a modern conference room"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent z-10 opacity-30 mix-blend-overlay" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Trusted by — client/partner logo rotator */}
      <section className="py-16 bg-card border-y border-border">
        <div className="container mx-auto px-4">
          <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-6">
            Trusted by
          </p>
          <LogoRotator logos={rotatorLogos} />
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
    </div>
  );
}
