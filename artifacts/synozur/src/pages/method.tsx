import { Meta } from "@/lib/meta";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { CtaBlock } from "@/components/cta/CtaBlock";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-100px" },
  transition: { duration: 0.7, ease: "easeOut" as const },
};

const PHASES = [
  {
    phase: "01",
    name: "Assess",
    tagline: "Find the North Star",
    points: [
      "Executive and Board alignment on where the business is really headed",
      "An honest read of AI readiness across the operating model",
      "A measurable before-state baseline you can hold us to",
    ],
  },
  {
    phase: "02",
    name: "Define",
    tagline: "Build the operating model",
    points: [
      "Design the AI-first operating model for how the business actually runs",
      "Set the governance, policy, and decision rights that make it defensible",
      "Prioritize the moves with the clearest path to measurable impact",
    ],
  },
  {
    phase: "03",
    name: "Deliver",
    tagline: "Establish execution rhythm",
    points: [
      "Stand up a working prototype and a roadmap teams can execute",
      "Install the operating cadence that keeps strategy and delivery aligned",
      "Equip leaders to run the model without depending on us",
    ],
  },
  {
    phase: "04",
    name: "Outcomes",
    tagline: "Make change stick",
    points: [
      "Prove the business impact against the baseline — outcomes, not promises",
      "Embed the habits and accountability that keep the change in place",
      "Identify the next horizon of AI-first advantage",
    ],
  },
];

export default function Method() {
  return (
    <div className="w-full">
      <Meta
        title="The North Star Method™"
        description="Synozur's North Star Method™ — a repeatable, four-phase system (Assess, Define, Deliver, Outcomes) that redesigns your operating model for an AI-first world and proves the impact."
        path="/method"
      />

      <section className="relative overflow-hidden bg-[#0B0B1A] py-24 md:py-32">
        <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-25" />
        <div className="container relative z-10 mx-auto max-w-4xl px-4">
          <p className="mb-4 text-sm uppercase tracking-widest text-primary">
            How we work
          </p>
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-white md:text-6xl">
            The North Star Method™
          </h1>
          <p className="max-w-2xl text-xl leading-relaxed text-zinc-300">
            Not theory. A repeatable system that takes you from finding your
            North Star to making the change stick — with measurable outcomes at
            every phase.
          </p>
        </div>
      </section>

      <section className="bg-background py-20 md:py-28">
        <div className="container mx-auto max-w-5xl px-4 md:px-6">
          <div className="space-y-8">
            {PHASES.map((p) => (
              <motion.div
                key={p.phase}
                {...fadeUp}
                className="rounded-2xl border border-border bg-card p-8 md:p-10"
              >
                <div className="flex flex-col gap-8 md:flex-row md:items-start">
                  <div className="md:w-1/3">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-sm font-bold text-primary">
                      {p.phase}
                    </div>
                    <h2 className="text-2xl font-bold">{p.name}</h2>
                    <p className="mt-1 text-primary">{p.tagline}</p>
                  </div>
                  <ul className="space-y-4 md:w-2/3">
                    {p.points.map((point) => (
                      <li key={point} className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <span className="text-lg leading-relaxed">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <CtaBlock
        intent="book"
        source="method"
        heading="Put the method to work"
        body="The AI & North Star Sprint is the front door to the method — a 4–6 week executive engagement to define, design, and prove your AI-first operating model."
        ctaLabel="Book the Sprint"
        secondary={{ label: "See the proof", href: "/proof" }}
      />
    </div>
  );
}
