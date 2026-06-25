import "./_group.css";
import { Footer, Header } from "../_shared/SiteChrome";
import React from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock,
  Compass,
  Layers,
  MessageSquare,
  Sparkles,
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

const EXPECTATIONS = [
  {
    icon: Clock,
    text: "A 30–45 minute discussion grounded in your leadership context.",
  },
  {
    icon: Compass,
    text: "A clear perspective on where clarity or alignment may be limiting progress.",
  },
  {
    icon: Layers,
    text: "An initial view of how the Sprint would apply to your organization.",
  },
];

const SHARE_AHEAD = [
  "Your role and leadership context.",
  "The primary challenge you're navigating.",
  "Whether AI or operating model changes are part of the discussion.",
];

export function BookingRedesign() {
  return (
    <div className="synozur-root min-h-screen w-full bg-background text-foreground overflow-x-hidden selection:bg-primary/30">
      <Header bookHref="#calendar" active="Book" />

      <main>
        {/* Hero — page header + opening frame (booking page hero pattern) */}
        <section className="relative overflow-hidden bg-[#0B0B1A] pt-36 pb-20 md:pt-40 md:pb-24">
          <div className="absolute inset-0 z-0">
            <img src={SKY.coast} alt="" className="w-full h-full object-cover opacity-45" />
            <div className="absolute inset-0 bg-gradient-to-b from-[#0B0B1A]/50 via-[#0B0B1A]/60 to-[#0B0B1A]" />
            <div className="absolute inset-0 nebula-gradient opacity-20 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 max-w-4xl">
            <motion.p
              {...fadeUp}
              className="text-sm uppercase tracking-widest text-primary mb-4 inline-flex items-center gap-2"
            >
              <CalendarDays className="h-4 w-4" />
              Book time
            </motion.p>
            <motion.h1
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.05 }}
              className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 leading-[1.05]"
            >
              Schedule the <span className="nebula-text">conversation</span>.
            </motion.h1>
            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.1 }}
              className="text-lg md:text-2xl text-zinc-300 leading-relaxed max-w-3xl"
            >
              This is a focused working conversation — designed to understand your current context,
              where alignment may be breaking down, and whether the Sprint is the right next step.
            </motion.p>
          </div>
        </section>

        {/* Body: expectation setting + calendar, with context rail */}
        <div className="container mx-auto px-4 md:px-6 py-16 md:py-20 max-w-7xl">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-10 items-start">
            {/* LEFT: expectations, reframe, calendar embed, microcopy */}
            <div className="space-y-10">
              {/* What to expect */}
              <motion.section {...fadeUp}>
                <p className="text-sm uppercase tracking-[0.25em] text-primary mb-5">
                  What to expect
                </p>
                <div className="space-y-4">
                  {EXPECTATIONS.map((e, i) => {
                    const Icon = e.icon;
                    return (
                      <div
                        key={i}
                        className="flex gap-4 rounded-2xl border border-border/60 bg-card p-5 nebula-card"
                      >
                        <div className="h-11 w-11 shrink-0 rounded-xl border border-primary/30 bg-primary/10 flex items-center justify-center">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <p className="text-[15px] md:text-base leading-relaxed text-foreground/90 self-center">
                          {e.text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </motion.section>

              {/* Calendar insert point */}
              <motion.section
                id="calendar"
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.05 }}
                className="scroll-mt-28"
              >
                <div
                  className="relative overflow-hidden rounded-2xl border border-border bg-card"
                  data-testid="booking-embed"
                >
                  <div className="absolute inset-0 z-0">
                    <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-10" />
                  </div>
                  <div className="relative z-10 flex min-h-[460px] flex-col items-center justify-center px-6 py-16 text-center">
                    <div className="h-14 w-14 mb-5 rounded-2xl border border-primary/30 bg-primary/10 flex items-center justify-center">
                      <CalendarDays className="h-7 w-7 text-primary" />
                    </div>
                    <p className="text-lg font-semibold text-white mb-1">Embed your scheduler here</p>
                    <p className="text-sm text-muted-foreground max-w-md">
                      The Microsoft Bookings calendar slots into this panel — pick a time that fits
                      your leadership context.
                    </p>
                  </div>
                </div>

                {/* Microcopy under calendar */}
                <div className="mt-7 rounded-2xl border border-border/60 bg-card/60 p-6 md:p-7">
                  <p className="text-[15px] md:text-base text-foreground/90 leading-relaxed mb-4">
                    You can share as much or as little context as you like ahead of time. If helpful,
                    we recommend including:
                  </p>
                  <ul className="space-y-2.5">
                    {SHARE_AHEAD.map((item, i) => (
                      <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-muted-foreground">
                        <Sparkles className="h-4 w-4 text-primary/70 shrink-0 mt-1" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.section>
            </div>

            {/* RIGHT: reframe + human context rail */}
            <div className="space-y-6 lg:sticky lg:top-28">
              {/* Reframe the interaction */}
              <motion.div
                {...fadeUp}
                className="relative overflow-hidden rounded-3xl border border-primary/30 p-7 md:p-8 nebula-card"
              >
                <div className="absolute inset-0 z-0">
                  <img src={SKY.galaxy} alt="" className="w-full h-full object-cover opacity-20" />
                  <div className="absolute inset-0 bg-card/85" />
                </div>
                <div className="relative z-10">
                  <MessageSquare className="h-7 w-7 text-primary/80 mb-4" aria-hidden="true" />
                  <p className="text-xl md:text-2xl font-semibold text-white leading-snug mb-3">
                    This is not a generic discovery call.
                  </p>
                  <p className="text-[15px] md:text-base text-zinc-300 leading-relaxed">
                    It is a structured conversation to determine whether this work is necessary — and
                    what it would look like if it is.
                  </p>
                </div>
              </motion.div>

              {/* Human context */}
              <motion.div
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.07 }}
                className="rounded-3xl border border-border/60 bg-card/70 p-7 md:p-8"
              >
                <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground mb-3">
                  Tailored to you
                </p>
                <p className="text-lg md:text-xl font-semibold text-foreground leading-snug mb-3">
                  We understand that every organization is different.
                </p>
                <p className="text-[15px] md:text-base text-muted-foreground leading-relaxed">
                  This conversation is tailored to your specific situation — not a predefined pitch
                  or framework.
                </p>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Decision reinforcement + human close over sky */}
        <section className="relative overflow-hidden border-t border-border py-24">
          <div className="absolute inset-0 z-0">
            <img src={SKY.people} alt="" className="w-full h-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-[#0B0B1A]/85" />
            <div className="absolute inset-0 nebula-gradient opacity-12 mix-blend-screen" />
          </div>
          <div className="container relative z-10 mx-auto px-4 md:px-6 max-w-3xl text-center">
            <motion.p
              {...fadeUp}
              className="text-xl md:text-2xl text-zinc-200 leading-relaxed"
            >
              The goal is not to sell anything in this conversation. It is to determine whether
              aligning around clarity and direction would{" "}
              <span className="nebula-text font-semibold">
                meaningfully change how your organization operates
              </span>
              .
            </motion.p>

            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.1 }}
              className="my-10 mx-auto h-px w-24 bg-border"
            />

            <motion.p
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.14 }}
              className="text-lg md:text-xl text-zinc-300 leading-relaxed"
            >
              If now isn't the right time, that's completely fine. But if you're at a point where{" "}
              <span className="text-white font-medium">clarity matters more than activity</span>,
              this is the right place to start.
            </motion.p>

            <motion.div
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.18 }}
              className="mt-10"
            >
              <a
                href="#calendar"
                className="h-12 px-8 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-base font-medium transition-colors hover:bg-primary/90"
              >
                <CalendarDays className="mr-2 h-4 w-4" /> Schedule the conversation
              </a>
            </motion.div>
          </div>
        </section>

        <Footer />
      </main>
    </div>
  );
}
