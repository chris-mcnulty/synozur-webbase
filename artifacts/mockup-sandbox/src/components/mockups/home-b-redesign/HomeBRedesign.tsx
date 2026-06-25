import "./_group.css";
import { Footer, Header } from "../_shared/SiteChrome";
import React, { useState, useEffect } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { 
  ArrowRight, CheckCircle2, ChevronRight, 
  BarChart3, Settings2, ShieldAlert, Target, XCircle,
  Briefcase, Network, Lightbulb, Activity, ArrowUpRight
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-100px" },
  transition: { duration: 0.7, ease: [0.21, 0.47, 0.32, 0.98] }
};

const staggerContainer = {
  initial: { opacity: 0 },
  whileInView: { opacity: 1 },
  viewport: { once: true, margin: "-100px" },
  transition: { staggerChildren: 0.1 }
};

// Static recreation of the live site's API-driven "From The Feed" carousel.
const FEED_ITEMS = [
  {
    img: "/__mockup/images/insight-1.png",
    category: "Insight",
    title: "From AI-ready to AI-first: what actually changes in the operating model",
  },
  {
    img: "/__mockup/images/insight-2.png",
    category: "Model",
    title: "The North Star Method™ — a repeatable system for AI-first transformation",
  },
  {
    img: "/__mockup/images/insight-3.png",
    category: "Case Study",
    title: "$2M EBITDA impact from a Company OS redesign",
  },
];

function FeedCarousel() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const id = window.setInterval(
      () => setCurrent((c) => (c + 1) % FEED_ITEMS.length),
      6000,
    );
    return () => window.clearInterval(id);
  }, []);

  const go = (dir: number) =>
    setCurrent((c) => (c + dir + FEED_ITEMS.length) % FEED_ITEMS.length);

  const item = FEED_ITEMS[current];

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4">
        <p className="text-sm uppercase tracking-[0.25em] text-primary">From The Feed</p>
        <div className="hidden md:flex gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous slide"
            className="h-9 w-9 rounded-full border border-border bg-card/60 backdrop-blur-md flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next slide"
            className="h-9 w-9 rounded-full border border-border bg-card/60 backdrop-blur-md flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <motion.div
        key={current}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="group block overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
      >
        <div className="relative aspect-[16/10] overflow-hidden">
          <img src={item.img} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent" />
        </div>
        <div className="p-6 md:p-7">
          <p className="text-xs uppercase tracking-[0.2em] text-primary mb-3">{item.category}</p>
          <h3 className="text-xl font-bold leading-snug mb-4">{item.title}</h3>
          <span className="inline-flex items-center gap-1.5 text-sm text-primary font-semibold">
            Read more <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </motion.div>
      <div className="flex items-center justify-center gap-2 mt-6">
        {FEED_ITEMS.map((it, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setCurrent(i)}
            aria-label={`Show slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              current === i ? "w-8 bg-primary" : "w-3 bg-white/25 hover:bg-white/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function HomeBRedesign() {
  return (
    <div className="synozur-root min-h-screen w-full bg-background text-foreground overflow-x-hidden selection:bg-primary/30">
      
      <Header active="Home" />

      <main>
        {/* 1. Hero — two-column: copy left, From The Feed carousel right, over background video */}
        <section className="relative min-h-[92vh] flex items-center bg-[#0B0B1A] overflow-hidden">
          {/* Background video */}
          <div className="absolute inset-0 z-0 opacity-60">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0B0B1A] z-10" />
            <video
              autoPlay
              muted
              loop
              playsInline
              poster="/__mockup/images/hero-bg.png"
              className="w-full h-full object-cover"
              data-decorative="true"
            >
              <source src="/__mockup/videos/hero-bg.webm" type="video/webm" />
              <source src="/__mockup/videos/hero-bg.mp4" type="video/mp4" />
            </video>
          </div>
          {/* Subtle glow accent */}
          <div className="absolute top-1/4 left-1/4 w-[40vw] h-[40vh] bg-primary/20 rounded-full blur-[120px] mix-blend-screen opacity-40 pointer-events-none z-0" />

          <div className="container relative z-10 mx-auto px-4 md:px-6 py-28 md:py-32">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">

              {/* Left: prominent logo + copy */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="lg:col-span-6"
              >
                <img
                  src="/__mockup/images/sa-logo-horizontal-white.png"
                  alt="The Synozur Alliance"
                  className="h-24 md:h-32 w-auto max-w-full mb-10"
                  style={{ mixBlendMode: "screen" }}
                />
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.06] mb-8 text-white">
                  Become <span className="nebula-text">AI-first</span> — before disruption decides for you.
                </h1>
                <p className="text-lg md:text-xl text-zinc-300 mb-10 max-w-xl leading-relaxed">
                  Synozur is the AI-native advisory firm for founder-led and PE-backed CEOs and Boards. We redesign your operating model for an AI-first world — then prove the business impact with measurable outcomes, not promises.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 mb-8">
                  <a
                    href="#sprint"
                    className="h-14 px-8 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-medium text-lg transition-all hover:bg-primary/90 hover:scale-[1.02] shadow-[0_0_20px_rgba(129,15,251,0.3)]"
                  >
                    Book the AI &amp; North Star Sprint
                  </a>
                  <a
                    href="#proof"
                    className="h-14 px-8 inline-flex items-center justify-center rounded-md border border-white/20 bg-white/5 text-white backdrop-blur-sm font-medium text-lg transition-all hover:bg-white/10"
                  >
                    See proof, not promises
                  </a>
                </div>
                <div className="text-sm md:text-base text-zinc-400 flex items-center gap-2 flex-wrap">
                  <span>AI-ready</span>
                  <ChevronRight className="h-4 w-4 opacity-50" />
                  <span>AI-enabled</span>
                  <ChevronRight className="h-4 w-4 opacity-50" />
                  <strong className="text-white font-semibold">AI-first</strong>
                  <span className="hidden sm:inline-block mx-1 opacity-50">—</span>
                  <span>we install the model and prove the differential.</span>
                </div>
              </motion.div>

              {/* Right: existing From The Feed carousel */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
                className="lg:col-span-6"
              >
                <FeedCarousel />
              </motion.div>
            </div>
          </div>
        </section>

        {/* 2. Pain First (AI-RX) */}
        <section className="py-24 md:py-32 bg-background relative border-y border-border/40">
          <div className="container mx-auto px-4 md:px-6 max-w-5xl">
            <motion.div {...fadeUp} className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
                The problem isn't AI. It's your operating model.
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
                Most firms deliver strategy. Few redesign how the business actually operates.
              </p>
            </motion.div>

            <motion.div 
              variants={staggerContainer}
              initial="initial"
              whileInView="whileInView"
              className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16"
            >
              {[
                {
                  icon: <BarChart3 className="h-6 w-6 text-primary" />,
                  text: "AI investment without measurable ROI"
                },
                {
                  icon: <Network className="h-6 w-6 text-primary" />,
                  text: "Scattered pilots with no path to scale"
                },
                {
                  icon: <ShieldAlert className="h-6 w-6 text-primary" />,
                  text: "No defensible AI governance or policy"
                },
                {
                  icon: <Activity className="h-6 w-6 text-primary" />,
                  text: "Leadership teams behind, overwhelmed, and reacting too late"
                }
              ].map((pain, i) => (
                <motion.div 
                  key={i} 
                  variants={fadeUp}
                  className="bg-card/50 border border-border p-6 rounded-xl flex items-start gap-4 hover:border-primary/50 transition-colors"
                >
                  <div className="p-3 bg-primary/10 rounded-lg shrink-0">
                    {pain.icon}
                  </div>
                  <p className="text-lg font-medium leading-tight pt-1">
                    {pain.text}
                  </p>
                </motion.div>
              ))}
            </motion.div>

            <motion.div {...fadeUp}>
              <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-8 md:p-10 text-center shadow-[0_0_40px_rgba(129,15,251,0.1)]">
                <div className="absolute top-0 left-0 w-full h-1 nebula-gradient" />
                <h3 className="text-xl md:text-2xl font-semibold leading-relaxed">
                  If your operating model doesn't adapt, AI will reshape your company without you.
                </h3>
              </div>
            </motion.div>
          </div>
        </section>

        {/* 3. The Front Door — the Sprint */}
        <section id="sprint" className="py-24 md:py-32 bg-[hsl(240_35%_9%)] relative">
          <div className="container mx-auto px-4 md:px-6 max-w-5xl">
            <motion.div {...fadeUp} className="mb-12">
              <p className="text-sm uppercase tracking-[0.25em] text-primary font-bold mb-4">
                The Front Door
              </p>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
                The AI & North Star Sprint
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl leading-relaxed">
                A 4–6 week executive engagement for CEOs and Boards to define, design, and prove an AI-first operating model.
              </p>
            </motion.div>

            <motion.div 
              {...fadeUp}
              className="bg-background border border-border rounded-2xl overflow-hidden relative shadow-2xl"
            >
              {/* Subtle top gradient */}
              <div className="absolute top-0 inset-x-0 h-px nebula-gradient" />
              
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
                {/* Column A */}
                <div className="p-8 md:p-12">
                  <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-8 flex items-center gap-3">
                    <span className="h-px bg-border flex-grow" />
                    What happens
                  </h3>
                  <ul className="space-y-6">
                    {[
                      "Find your North Star (assessment + executive alignment)",
                      "Design the AI-first operating model",
                      "Build a working prototype and roadmap"
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-4">
                        <div className="mt-1 h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <div className="h-2 w-2 rounded-full bg-primary" />
                        </div>
                        <span className="text-lg font-medium">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                
                {/* Column B */}
                <div className="p-8 md:p-12 bg-card/30">
                  <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-8 flex items-center gap-3">
                    What you leave with
                    <span className="h-px bg-border flex-grow" />
                  </h3>
                  <ul className="space-y-6">
                    {[
                      "Clear strategic direction",
                      "AI-first execution plan",
                      "Measurable before-and-after baseline"
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-4">
                        <CheckCircle2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                        <span className="text-lg font-medium">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              
              <div className="p-8 md:p-12 bg-card border-t border-border flex justify-center">
                <a 
                  href="#"
                  className="h-14 px-10 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-medium text-lg transition-all hover:bg-primary/90 shadow-[0_0_20px_rgba(129,15,251,0.2)]"
                >
                  Start the Sprint
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </div>
            </motion.div>
          </div>
        </section>

        {/* 4. Proof */}
        <section id="proof" className="py-24 md:py-32 bg-background border-y border-border/40">
          <div className="container mx-auto px-4 md:px-6 max-w-6xl">
            <motion.div {...fadeUp} className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
                Proof, not promises
              </h2>
            </motion.div>

            <motion.div 
              variants={staggerContainer}
              initial="initial"
              whileInView="whileInView"
              className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-16"
            >
              {[
                {
                  metric: "$500K–$2.0M+",
                  sub: "EBITDA impact",
                  text: "Leadership decision-making accelerated through a Company OS redesign."
                },
                {
                  metric: "$1M–$5M",
                  sub: "revenue lift",
                  text: "Positioning and GTM execution aligned across teams."
                },
                {
                  metric: "$2M–$6M",
                  sub: "productivity gains",
                  text: "AI-enabled workflows reduced friction at scale."
                }
              ].map((proof, i) => (
                <motion.div 
                  key={i}
                  variants={fadeUp}
                  className="group relative flex flex-col p-8 rounded-2xl bg-card border border-border hover:border-primary/30 transition-colors"
                >
                  <div className="mb-6 pb-6 border-b border-border/50">
                    <h3 className="text-3xl md:text-4xl font-bold text-foreground mb-2 tracking-tight">
                      {proof.metric}
                    </h3>
                    <p className="text-primary font-medium text-sm uppercase tracking-wider">
                      {proof.sub}
                    </p>
                  </div>
                  <p className="text-lg text-muted-foreground leading-relaxed flex-grow">
                    {proof.text}
                  </p>
                </motion.div>
              ))}
            </motion.div>

            <motion.div {...fadeUp} className="text-center">
              <a 
                href="#"
                className="inline-flex items-center justify-center text-primary font-medium hover:text-primary/80 transition-colors"
              >
                View detailed case studies
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </a>
            </motion.div>
          </div>
        </section>

        {/* 5. Who this is for (ICP) — paired with editorial image */}
        <section id="fit" className="py-24 md:py-32 bg-[hsl(240_35%_9%)] relative overflow-hidden">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[30vw] h-[60vh] bg-secondary/10 rounded-full blur-[100px] pointer-events-none" />

          <div className="container mx-auto px-4 md:px-6 max-w-6xl relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

              {/* Left: heading + audience */}
              <motion.div {...fadeUp}>
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-8">
                  Who this is for
                </h2>
                <div className="p-6 border-l-2 border-primary bg-primary/5 rounded-r-xl mb-8">
                  <p className="text-xl font-medium leading-relaxed">
                    <span className="text-foreground">Mid-market. Privately held.</span><br/>
                    <span className="text-muted-foreground">AI pressure is real — and time is limited.</span>
                  </p>
                </div>
                <div className="flex flex-col gap-4">
                  {[
                    { icon: <Briefcase className="h-5 w-5" />, text: "Founder-led and PE-backed CEOs" },
                    { icon: <Target className="h-5 w-5" />, text: "Boards and portfolio operators" },
                    { icon: <Lightbulb className="h-5 w-5" />, text: "COOs, CTOs, and emerging Chief AI Officers" }
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-5 p-5 bg-card border border-border rounded-xl"
                    >
                      <div className="h-11 w-11 rounded-full bg-background border border-border flex items-center justify-center shrink-0 text-primary">
                        {item.icon}
                      </div>
                      <span className="text-lg md:text-xl font-medium">{item.text}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-8">
                  <a
                    href="/about"
                    className="inline-flex items-center text-primary font-semibold hover:text-primary/80 transition-colors"
                  >
                    Why Synozur <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </div>
              </motion.div>

              {/* Right: editorial image (moved down from the top of the page) */}
              <motion.div
                {...fadeUp}
                className="relative aspect-[4/5] lg:aspect-square rounded-2xl overflow-hidden border border-border/50 shadow-2xl bg-card"
              >
                <img
                  src="/__mockup/images/who-we-work-with.png"
                  alt="Reaching toward the North Star"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-30 mix-blend-overlay" />
              </motion.div>
            </div>
          </div>
        </section>

        {/* Trusted by — partner logo strip, directly below "Who this is for" */}
        <section className="py-16 bg-background border-b border-border/40">
          <div className="container mx-auto px-4 md:px-6">
            <p className="text-xs uppercase tracking-[0.25em] text-primary text-center mb-10">
              Trusted by
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
              {[
                { slug: "microsoft", name: "Microsoft" },
                { slug: "nfl", name: "NFL" },
                { slug: "oxy", name: "Oxy" },
                { slug: "pfizer", name: "Pfizer" },
                { slug: "quest", name: "Quest" },
                { slug: "santander", name: "Santander" },
                { slug: "dell-technologies", name: "Dell Technologies" },
                { slug: "sony", name: "Sony" }
              ].map((logo) => (
                <img
                  key={logo.slug}
                  src={`/__mockup/images/logos/${logo.slug}.png`}
                  alt={logo.name}
                  className="h-7 md:h-9 w-auto object-contain opacity-70 hover:opacity-100 transition-opacity"
                />
              ))}
            </div>
          </div>
        </section>

        {/* 6. What we are not */}
        <section className="py-24 md:py-32 bg-background border-y border-border/40">
          <div className="container mx-auto px-4 md:px-6 max-w-4xl text-center">
            <motion.div {...fadeUp} className="mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
                What we are not
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
                We operate at the CEO and Board level — where strategy, operating model, and outcomes align.
              </p>
            </motion.div>

            <motion.div 
              variants={staggerContainer}
              initial="initial"
              whileInView="whileInView"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 text-left"
            >
              {[
                "Not implementation or staff augmentation",
                "Not generic AI training",
                "Not a \"body shop\" or delivery factory",
                "Not one-size-fits-all frameworks"
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  variants={fadeUp}
                  className="flex items-center gap-3 p-5 rounded-lg bg-card/30 border border-border/50 text-muted-foreground"
                >
                  <XCircle className="h-5 w-5 text-destructive/70 shrink-0" />
                  <span className="text-lg font-medium line-through decoration-destructive/30 decoration-2">{item}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* 7. AI, with judgment */}
        <section className="py-24 md:py-32 bg-[hsl(240_35%_9%)] relative">
          <div className="container mx-auto px-4 md:px-6 max-w-5xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <motion.div {...fadeUp}>
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
                  AI, with judgment
                </h2>
                <p className="text-xl text-muted-foreground leading-relaxed mb-8">
                  AI accelerates our work. It does not replace our judgment.
                </p>
                <div className="inline-block px-6 py-4 rounded-lg border border-primary/20 bg-primary/10">
                  <p className="text-xl md:text-2xl font-bold nebula-text">
                    No AI slop. Ever.
                  </p>
                </div>
              </motion.div>

              <motion.div 
                variants={staggerContainer}
                initial="initial"
                whileInView="whileInView"
                className="space-y-6"
              >
                {[
                  "Every deliverable is reviewed by a human expert",
                  "No client output ships AI-only",
                  "No impersonation. No automation in place of trust."
                ].map((item, i) => (
                  <motion.div key={i} variants={fadeUp} className="flex items-start gap-4">
                    <CheckCircle2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                    <p className="text-lg md:text-xl font-medium">{item}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </div>
        </section>

        {/* 8. The North Star Method™ */}
        <section id="method" className="py-24 md:py-32 bg-background border-y border-border/40">
          <div className="container mx-auto px-4 md:px-6 max-w-6xl">
            <motion.div {...fadeUp} className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">
                The North Star Method™
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
                Not theory. A repeatable system tied to measurable outcomes.
              </p>
            </motion.div>

            <motion.div 
              variants={staggerContainer}
              initial="initial"
              whileInView="whileInView"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative"
            >
              {/* Desktop connecting line */}
              <div className="hidden lg:block absolute top-6 left-[12.5%] right-[12.5%] h-px bg-border" />

              {[
                { phase: "01", name: "Assess", desc: "Find the North Star" },
                { phase: "02", name: "Define", desc: "Build the operating model" },
                { phase: "03", name: "Deliver", desc: "Establish execution rhythm" },
                { phase: "04", name: "Outcomes", desc: "Make change stick" }
              ].map((step, i) => (
                <motion.div key={i} variants={fadeUp} className="relative z-10">
                  <div className="bg-background flex flex-col p-6 rounded-2xl border border-border h-full relative group hover:border-primary/50 transition-colors">
                    <div className="h-8 w-8 rounded-full bg-card border border-border flex items-center justify-center text-xs font-bold text-muted-foreground mb-6 lg:mx-auto lg:-mt-10 group-hover:border-primary group-hover:text-primary transition-colors">
                      {step.phase}
                    </div>
                    <div className="lg:text-center">
                      <h3 className="text-xl font-bold mb-2">{step.name}</h3>
                      <p className="text-sm text-muted-foreground">{step.desc}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* 9. Final CTA */}
        <section className="py-24 md:py-32 relative overflow-hidden">
          <div className="absolute inset-0 nebula-gradient opacity-90" />
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-30 mix-blend-overlay" />
          
          <div className="container mx-auto px-4 md:px-6 relative z-10 max-w-4xl text-center">
            <motion.div {...fadeUp}>
              <h2 className="text-4xl md:text-6xl font-bold text-white mb-8 tracking-tight">
                Find your North Star
              </h2>
              <p className="text-xl md:text-2xl text-white/90 mb-12 max-w-2xl mx-auto leading-relaxed font-medium">
                If you're moving from AI-ready to AI-first, we guide the entire journey — with clarity, momentum, and proof.
              </p>
              <a 
                href="#sprint"
                className="h-16 px-10 inline-flex items-center justify-center rounded-md bg-white text-primary font-bold text-xl transition-transform hover:scale-105 shadow-xl"
              >
                Book the Sprint
              </a>
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
