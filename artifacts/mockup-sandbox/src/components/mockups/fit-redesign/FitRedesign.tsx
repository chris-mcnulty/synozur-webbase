import "./_group.css";
import { Footer, Header } from "../_shared/SiteChrome";
import React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Minus,
  Compass,
  Sparkles,
  Layers,
  Users,
  Clock,
  Target,
  MessageSquare,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" },
};

// Resized North Star sky images, used as swap-later placeholders.
const SKY = {
  galaxy: "/__mockup/images/sky-galaxy-web.jpg",
  coast: "/__mockup/images/sky-coast-web.jpg",
  people: "/__mockup/images/sky-people-web.jpg",
};

const PRIMARY_CONDITIONS = [
  {
    icon: Target,
    text: "The leadership team recognizes that something is not working as it should — even if performance is still strong.",
  },
  {
    icon: Compass,
    text: "There is openness to rethinking how decisions are made and how priorities are set.",
  },
  {
    icon: Sparkles,
    text: "Strategic direction matters more than short-term activity.",
  },
  {
    icon: Layers,
    text: "AI is seen as an opportunity — but not yet fully understood at a leadership level.",
  },
  {
    icon: Users,
    text: "Growth or change has introduced complexity that requires a more intentional operating model.",
  },
];

const EXCLUSIONS = [
  "The focus is on immediate implementation rather than clarity and direction.",
  "Leadership alignment is not accessible at this stage.",
  "The expectation is a predefined solution.",
];

const EXPECTATIONS = [
  {
    icon: Clock,
    text: "A 30–45 minute working discussion with your leadership context in mind.",
  },
  {
    icon: Compass,
    text: "A clear perspective on where alignment may be limiting progress.",
  },
  {
    icon: Layers,
    text: "An initial view of how the Sprint would be structured for your organization.",
  },
];

export function FitRedesign() {
  return (
    <div className="synozur-root min-h-screen w-full bg-background text-foreground overflow-x-hidden selection:bg-primary/30">
      <Header active="Fit" />

      <main>
        {/* 1. Hero over a North Star sky */}
        <section className="relative min-h-[600px] flex items-center overflow-hidden bg-[#0B0B1A]">
          <div className="absolute inset-0 z-0">
            <img src={SKY.coast} alt="" className="w-full h-full object-cover opacity-55" />
            <div className="absolute inset-0 bg-gradient-to-b from-[#0B0B1A]/40 via-[#0B0B1A]/55 to-[#0B0B1A]" />
            <div className="absolute inset-0 nebula-gradient opacity-15 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 pt-28 pb-20 max-w-4xl">
            <motion.p {...fadeUp} className="text-sm uppercase tracking-[0.25em] text-primary mb-5">
              Is this right for you?
            </motion.p>
            <motion.h1
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.05 }}
              className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 leading-[1.05]"
            >
              This work requires a certain level of <span className="nebula-text">readiness</span>.
            </motion.h1>
            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.1 }}
              className="text-xl md:text-2xl text-zinc-300 leading-relaxed max-w-3xl"
            >
              The Sprint is most effective when leadership teams are ready to step back, align on
              what matters, and make decisions that will shape how the organization operates.
            </motion.p>
          </div>
        </section>

        {/* 2. Primary conditions — when the Sprint creates the most value */}
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4 md:px-6">
            <div className="max-w-3xl mb-12">
              <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">A strong fit</p>
              <h2 className="text-3xl md:text-5xl font-bold">
                The Sprint tends to create the most value when…
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {PRIMARY_CONDITIONS.map((c, i) => {
                const Icon = c.icon;
                return (
                  <motion.div
                    key={i}
                    {...fadeUp}
                    transition={{ ...fadeUp.transition, delay: (i % 2) * 0.07 }}
                    className="flex gap-4 rounded-2xl border border-border/60 bg-card p-6 nebula-card"
                  >
                    <div className="h-11 w-11 shrink-0 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <p className="text-[15px] md:text-base leading-relaxed text-foreground/90 self-center">
                      {c.text}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 3. The key line — leadership engagement */}
        <section className="relative overflow-hidden border-y border-border">
          <div className="absolute inset-0 z-0">
            <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-background/80" />
            <div className="absolute inset-0 nebula-gradient opacity-10 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 py-24 text-center max-w-3xl">
            <motion.h2
              {...fadeUp}
              className="text-3xl md:text-5xl font-bold text-white leading-tight"
            >
              This work requires <span className="nebula-text">leadership engagement</span>.
            </motion.h2>
            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.08 }}
              className="mt-5 text-xl md:text-2xl text-zinc-300"
            >
              It is not something that can be delegated.
            </motion.p>
          </div>
        </section>

        {/* 4. Light exclusion + human-centered close */}
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 items-start">
              {/* Exclusion list */}
              <motion.div {...fadeUp}>
                <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground mb-3">
                  A few honest caveats
                </p>
                <h2 className="text-2xl md:text-3xl font-bold mb-7">
                  The Sprint may not be the right fit when…
                </h2>
                <ul className="space-y-3">
                  {EXCLUSIONS.map((e, i) => (
                    <li
                      key={i}
                      className="flex gap-3 rounded-xl border border-border/50 bg-card/60 p-4"
                    >
                      <Minus className="h-5 w-5 text-muted-foreground/70 shrink-0 mt-0.5" />
                      <span className="text-[15px] leading-relaxed text-muted-foreground">{e}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>

              {/* Human-centered close */}
              <motion.div
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.1 }}
                className="relative overflow-hidden rounded-3xl border border-primary/30 p-8 md:p-12 nebula-card"
              >
                <div className="absolute inset-0 z-0">
                  <img src={SKY.people} alt="" className="w-full h-full object-cover opacity-20" />
                  <div className="absolute inset-0 bg-card/85" />
                </div>
                <div className="relative z-10">
                  <p className="text-2xl md:text-3xl font-semibold leading-snug text-white">
                    If that's not the right time, that's okay.
                  </p>
                  <p className="mt-5 text-lg md:text-xl leading-relaxed text-zinc-300">
                    But when leadership is ready to define what matters — and align around it —
                    that's where this work creates{" "}
                    <span className="nebula-text font-semibold">disproportionate impact</span>.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 5. CTA / Booking section */}
        <section id="book" className="relative overflow-hidden border-t border-border py-28">
          <div className="absolute inset-0 z-0">
            <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-[#0B0B1A]/85" />
            <div className="absolute inset-0 nebula-gradient opacity-15 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 max-w-5xl">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <motion.p
                {...fadeUp}
                className="text-sm uppercase tracking-[0.25em] text-primary mb-4"
              >
                The next step
              </motion.p>
              <motion.h2
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.05 }}
                className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight"
              >
                If this resonates, the next step is straightforward.
              </motion.h2>
              <motion.p
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.1 }}
                className="text-lg md:text-xl text-zinc-300 leading-relaxed"
              >
                The Sprint begins with a focused conversation to understand your current state,
                leadership context, and where alignment may be breaking down. From there, we
                determine if the Sprint is the right intervention — and how it would create value in
                your specific situation.
              </motion.p>
            </div>

            {/* What to expect */}
            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.12 }}
              className="grid md:grid-cols-3 gap-5 mb-12"
            >
              {EXPECTATIONS.map((e, i) => {
                const Icon = e.icon;
                return (
                  <div
                    key={i}
                    className="rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm p-6"
                  >
                    <div className="h-11 w-11 mb-4 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <p className="text-[15px] leading-relaxed text-foreground/90">{e.text}</p>
                  </div>
                );
              })}
            </motion.div>

            {/* Decision line + human close */}
            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.14 }}
              className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-sm p-8 md:p-12 text-center max-w-3xl mx-auto"
            >
              <MessageSquare className="h-8 w-8 text-primary/70 mx-auto mb-5" aria-hidden="true" />
              <p className="text-xl md:text-2xl font-semibold text-white leading-snug">
                This is not a generic discovery call.
              </p>
              <p className="mt-4 text-lg text-zinc-300 leading-relaxed">
                It is a focused, high-value conversation designed to determine whether this work is
                worth doing — and what it would look like if it is.
              </p>
              <div className="my-8 h-px bg-border/60" />
              <p className="text-base md:text-lg text-zinc-400 leading-relaxed">
                If now is not the right time, that's fine. But if you are at a point where{" "}
                <span className="text-white font-medium">clarity matters more than activity</span>,
                this is the right place to start.
              </p>

              <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="#book"
                  className="h-12 px-8 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-base font-medium transition-colors hover:bg-primary/90"
                >
                  Schedule the conversation <ArrowRight className="ml-2 h-4 w-4" />
                </a>
                <a
                  href="#"
                  className="h-12 px-8 inline-flex items-center justify-center rounded-md border border-white/25 bg-white/5 text-white text-base font-medium backdrop-blur-md transition-colors hover:bg-white/10"
                >
                  Or explore more case studies
                </a>
              </div>
            </motion.div>
          </div>
        </section>

        <Footer />
      </main>
    </div>
  );
}
