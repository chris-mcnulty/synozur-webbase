import type { ReactNode } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Lifecycle stages drive the portal's information architecture: each top-level
// nav entry is a stage that composes the apps feeding it. The home journey
// strip and the per-stage pages both read from this single source of truth, so
// renaming or re-ordering stages happens in one place.

export type LifecycleStageKey = "assess" | "define" | "deliver" | "outcomes";

export interface LifecycleStage {
  key: LifecycleStageKey;
  href: string;
  label: string;
  question: string;
  apps: { name: string; tagline: string }[];
}

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  {
    key: "assess",
    href: "/assess",
    label: "Assess",
    question: "Where are we starting?",
    apps: [
      { name: "Orbit", tagline: "Market overview, competitive analysis, intel" },
      { name: "Orion", tagline: "Maturity assessments and benchmarks" },
    ],
  },
  {
    key: "define",
    href: "/define",
    label: "Define",
    question: "What's the strategy and readiness?",
    apps: [
      { name: "Zenith", tagline: "Content state, AI readiness, policy" },
      { name: "Nebula", tagline: "Envisioning workspaces and reports" },
    ],
  },
  {
    key: "deliver",
    href: "/deliver",
    label: "Deliver",
    question: "What are we building together?",
    apps: [
      { name: "Constellation", tagline: "Projects, milestones, deliverables" },
    ],
  },
  {
    key: "outcomes",
    href: "/outcomes",
    label: "Outcomes",
    question: "Did the transformation stick?",
    apps: [{ name: "Vega", tagline: "Executive view of operations" }],
  },
] as const;

export function StageHeader({
  stage,
  description,
}: {
  stage: LifecycleStage;
  description?: string;
}) {
  const idx = LIFECYCLE_STAGES.findIndex((s) => s.key === stage.key);
  return (
    <header className="space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span>Stage {idx + 1} of {LIFECYCLE_STAGES.length}</span>
        <span aria-hidden="true">·</span>
        <span>Synozur lifecycle</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{stage.label}</h1>
      <p className="text-sm text-muted-foreground max-w-2xl">
        {description ?? stage.question}
      </p>
    </header>
  );
}

export function StageSection({
  title,
  app,
  children,
  action,
}: {
  title: string;
  app?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          {app ? (
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {app}
            </p>
          ) : null}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// Visual placeholder used for app integrations that aren't built yet (Orbit
// reports, Zenith policy/readiness, Vega exec dashboard). Communicates the
// shape of what's coming without faking data.
export function PlaceholderCard({
  title,
  description,
  status = "Coming soon",
}: {
  title: string;
  description: string;
  status?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-5 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wider">
            {status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

export function JourneyStrip() {
  return (
    <section
      aria-label="The Synozur journey"
      className="space-y-3"
      data-testid="journey-strip"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">The Synozur journey</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Assess → Define → Deliver → Outcomes
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {LIFECYCLE_STAGES.map((stage, i) => (
          <Link key={stage.key} href={stage.href}>
            {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
            <a
              className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
              data-testid={`journey-${stage.key}`}
            >
              <Card className="hover-elevate h-full">
                <CardContent className="p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/15 text-violet-300 text-xs font-semibold">
                      {i + 1}
                    </span>
                    <h3 className="text-base font-semibold leading-tight">
                      {stage.label}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {stage.question}
                  </p>
                  <ul className="pt-1 space-y-0.5">
                    {stage.apps.map((a) => (
                      <li key={a.name} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{a.name}</span>{" "}
                        — {a.tagline}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </a>
          </Link>
        ))}
      </div>
    </section>
  );
}
