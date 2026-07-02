import "./_group.css";
import { Footer, Header } from "../_shared/SiteChrome";
import React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Minus,
  Compass,
  Target,
  Wrench,
  Sparkles,
  Network,
  TrendingUp,
  Cpu,
  Users,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

// Resized North Star sky images, used as swap-later placeholders.
const SKY = {
  galaxy: "/__mockup/images/sky-galaxy-web.jpg",
  coast: "/__mockup/images/sky-coast-web.jpg",
  people: "/__mockup/images/sky-people-web.jpg",
};

const SIGNALS = [
  {
    icon: Network,
    text: "Leadership discussions that don't resolve into clear decisions.",
  },
  {
    icon: TrendingUp,
    text: "Strategic priorities that shift faster than teams can execute.",
  },
  {
    icon: Cpu,
    text: "AI initiatives that exist — but don't meaningfully change outcomes.",
  },
  {
    icon: Users,
    text: "Strong teams working hard, but not in the same direction.",
  },
  {
    icon: Compass,
    text: "Growth introducing friction instead of momentum.",
  },
];

const LOCK_IN = [
  "Execution becomes reactive.",
  "AI amplifies noise instead of clarity.",
  "Leadership alignment degrades under scale.",
];

const PHASES = [
  {
    phase: "Phase 1",
    title: "Assess",
    icon: Target,
    text: "Surface what is actually happening inside the business: where alignment is weak, where priorities conflict, where AI is adding noise instead of leverage, and where leadership is operating without a shared point of view.",
  },
  {
    phase: "Phase 2",
    title: "Define",
    icon: Compass,
    text: "Establish the North Star. Clarify the decisions that matter most, define the AI-first operating model the business actually needs, and align leadership on what the company is aiming at now — not just what it says it values.",
  },
  {
    phase: "Phase 3",
    title: "Deliver",
    icon: Wrench,
    text: "Translate strategy into a working prototype, roadmap, and operating rhythm. This is where direction becomes executable — through structured priorities, practical design, and a cadence the organization can realistically sustain.",
  },
  {
    phase: "Phase 4",
    title: "Outcomes",
    icon: Sparkles,
    text: "Leave with more than alignment. The Sprint creates a measurable starting point, a defined path forward, and a leadership team that can move with clarity instead of reacting under pressure.",
  },
];

const LEAVE_WITH = [
  "A clearly defined North Star for the business.",
  "An AI-first roadmap tied to business outcomes.",
  "A working prototype or executive-ready model of what changes next.",
  "A practical operating rhythm for leadership execution.",
  "A clearer baseline for measuring progress over time.",
];

const NOT_THIS = [
  "Not generic AI training.",
  "Not implementation-heavy consulting.",
  "Not a templated offsite.",
  "Not a strategy document that sits untouched after delivery.",
];

export function SprintRedesign() {
  return (
    <div className="synozur-root min-h-screen w-full bg-background text-foreground overflow-x-hidden selection:bg-primary/30">
      <Header active="The Sprint" />

      <main>
        {/* 1. Hero — the reframe */}
        <section className="relative min-h-[640px] flex items-center overflow-hidden bg-[#0B0B1A]">
          <div className="absolute inset-0 z-0">
            <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-55" />
            <div className="absolute inset-0 bg-gradient-to-b from-[#0B0B1A]/40 via-[#0B0B1A]/55 to-[#0B0B1A]" />
            <div className="absolute inset-0 nebula-gradient opacity-15 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 pt-28 pb-20 max-w-4xl">
            <motion.p {...fadeUp} className="text-sm uppercase tracking-[0.25em] text-primary mb-5">
              The AI &amp; North Star Sprint
            </motion.p>
            <motion.h1
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.05 }}
              className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6 leading-[1.08]"
            >
              The problem isn't how fast you're moving.
              <br />
              <span className="nebula-text">
                It's that your leadership team isn't aligned on what matters most.
              </span>
            </motion.h1>
            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.1 }}
              className="text-lg md:text-xl text-zinc-300 leading-relaxed max-w-3xl"
            >
              As organizations scale, complexity increases faster than clarity. Decisions fragment,
              priorities compete, and execution slows — not because teams lack capability, but
              because alignment has eroded. What looks like an execution problem is almost always a
              clarity problem.
            </motion.p>
          </div>
        </section>

        {/* 2. Diagnostic tension — the signals */}
        <section className="py-24 bg-background">
          <div className="container mx-auto px-4 md:px-6">
            <div className="max-w-3xl mb-12">
              <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">
                You are likely seeing some of this already
              </p>
              <h2 className="text-3xl md:text-5xl font-bold">
                What looks like execution friction is usually a missing North Star.
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {SIGNALS.map((s, i) => {
                const Icon = s.icon;
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
                      {s.text}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 3. Reframe lock-in — the advisor moment */}
        <section className="relative overflow-hidden border-y border-border">
          <div className="absolute inset-0 z-0">
            <img src={SKY.coast} alt="" className="w-full h-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-background/85" />
            <div className="absolute inset-0 nebula-gradient opacity-10 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 py-24 max-w-4xl">
            <motion.h2
              {...fadeUp}
              className="text-2xl md:text-4xl font-bold text-white leading-snug text-center mb-12"
            >
              Without a clearly defined and consistently applied{" "}
              <span className="nebula-text">North Star</span>:
            </motion.h2>
            <div className="grid md:grid-cols-3 gap-5 mb-12">
              {LOCK_IN.map((l, i) => (
                <motion.div
                  key={i}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: i * 0.07 }}
                  className="rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm p-6 text-center"
                >
                  <p className="text-lg font-medium text-foreground/90 leading-relaxed">{l}</p>
                </motion.div>
              ))}
            </div>
            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.12 }}
              className="text-xl md:text-2xl text-zinc-200 text-center max-w-2xl mx-auto leading-relaxed"
            >
              The issue isn't effort. It's that the system guiding that effort isn't explicit enough
              to scale.
            </motion.p>
          </div>
        </section>

        {/* 4. Sprint definition */}
        <section id="sprint-definition" className="py-24 bg-background">
          <div className="container mx-auto px-4 md:px-6">
            <div className="max-w-3xl mb-12">
              <p className="text-sm uppercase tracking-[0.25em] text-primary mb-3">The Sprint</p>
              <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
                A structured intervention for leaders who need clarity before they need cleanup.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                The AI &amp; North Star Sprint is a focused executive engagement for leadership teams
                that need to align on what matters, define an AI-first direction, and leave with a
                clear path forward. It is not a strategy deck. It is not generic AI training. It is a
                working intervention built to turn ambiguity into aligned decisions, a practical
                roadmap, and measurable next steps.
              </p>
            </div>

            {/* Highlight bar */}
            <motion.div
              {...fadeUp}
              className="rounded-2xl border border-primary/30 bg-primary/10 px-6 md:px-10 py-7 mb-14 text-center"
            >
              <p className="text-lg md:text-2xl font-semibold text-white tracking-tight">
                4–6 weeks &middot; CEO + Board &middot; Working prototype &middot; AI-first roadmap
              </p>
            </motion.div>

            {/* Phase grid */}
            <div className="grid md:grid-cols-2 gap-5">
              {PHASES.map((p, i) => {
                const Icon = p.icon;
                return (
                  <motion.div
                    key={i}
                    {...fadeUp}
                    transition={{ ...fadeUp.transition, delay: (i % 2) * 0.07 }}
                    className="rounded-2xl border border-border/60 bg-card p-7 nebula-card"
                  >
                    <div className="flex items-center gap-4 mb-4">
                      <div className="h-11 w-11 shrink-0 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-primary mb-1">
                          {p.phase}
                        </p>
                        <h3 className="text-xl font-bold">{p.title}</h3>
                      </div>
                    </div>
                    <p className="text-[15px] leading-relaxed text-foreground/80">{p.text}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 5. What you leave with / What this is not */}
        <section className="relative overflow-hidden border-t border-border py-24">
          <div className="absolute inset-0 z-0">
            <img src={SKY.people} alt="" className="w-full h-full object-cover opacity-20" />
            <div className="absolute inset-0 bg-background/90" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6">
            <div className="grid lg:grid-cols-2 gap-8">
              {/* What you leave with */}
              <motion.div
                {...fadeUp}
                className="rounded-3xl border border-primary/30 bg-card/80 backdrop-blur-sm p-8 md:p-10 nebula-card"
              >
                <h3 className="text-2xl md:text-3xl font-bold mb-7 text-white">
                  What you leave with
                </h3>
                <ul className="space-y-4">
                  {LEAVE_WITH.map((item, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="h-6 w-6 shrink-0 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mt-0.5">
                        <Check className="h-3.5 w-3.5 text-primary" />
                      </span>
                      <span className="text-[15px] md:text-base leading-relaxed text-foreground/90">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.div>

              {/* What this is not */}
              <motion.div
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.1 }}
                className="rounded-3xl border border-border/60 bg-card/60 backdrop-blur-sm p-8 md:p-10"
              >
                <h3 className="text-2xl md:text-3xl font-bold mb-7 text-foreground">
                  What this is not
                </h3>
                <ul className="space-y-4">
                  {NOT_THIS.map((item, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="h-6 w-6 shrink-0 rounded-full bg-muted/40 border border-border/60 flex items-center justify-center mt-0.5">
                        <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <span className="text-[15px] md:text-base leading-relaxed text-muted-foreground">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </div>
        </section>

        {/* 6. CTA */}
        <section
          id="book-the-sprint"
          className="relative overflow-hidden border-t border-border py-28"
        >
          <div className="absolute inset-0 z-0">
            <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-30" />
            <div className="absolute inset-0 bg-[#0B0B1A]/85" />
            <div className="absolute inset-0 nebula-gradient opacity-15 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 max-w-3xl text-center">
            <motion.h2
              {...fadeUp}
              className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight"
            >
              This is where the Sprint <span className="nebula-text">begins</span>.
            </motion.h2>
            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.08 }}
              className="text-lg md:text-xl text-zinc-300 leading-relaxed mb-10"
            >
              Turn ambiguity into aligned decisions, a practical roadmap, and measurable next steps.
            </motion.p>
            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.12 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <a
                href="#book-the-sprint"
                className="h-12 px-8 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-base font-medium transition-colors hover:bg-primary/90"
              >
                Book the Sprint <ArrowRight className="ml-2 h-4 w-4" />
              </a>
              <a
                href="#"
                className="h-12 px-8 inline-flex items-center justify-center rounded-md border border-white/25 bg-white/5 text-white text-base font-medium backdrop-blur-md transition-colors hover:bg-white/10"
              >
                See the proof
              </a>
            </motion.div>
          </div>
        </section>

        <Footer />
      </main>
    </div>
  );
}
